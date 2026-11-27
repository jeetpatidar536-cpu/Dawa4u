<?php
/**
 * Link to the dawa4u services (the Blinkit-style stack on the VPS: Kafka, Redis, Python microservices).
 *
 * WordPress stays the shop, the dashboards and the database of record. The services add:
 *   - Kafka event stream: every order step and stock count is sent to it (signed, non-blocking).
 *   - Redis stock holds: the last strip is held atomically at the best pharmacy that has everything.
 *   - eta-svc: delivery times learned per few streets (S2 cells), live rider GPS, "Arriving soon" at 100 m.
 *   - forecast-svc: next week's demand from a gradient-boosting model.
 * If the services are not set up or don't answer within a fraction of a second, everything falls back
 * to what WordPress does on its own — an order is never lost because the VPS is down.
 *
 * Settings: constants D4U_SVC_URL and D4U_SVC_SECRET (in wp-config.php or a file it includes), or
 * WooCommerce → dawa4u partners → Services.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function d4u_svc_url() {
	$u = defined( 'D4U_SVC_URL' ) ? D4U_SVC_URL : get_option( 'd4u_svc_url', '' );
	return rtrim( (string) $u, '/' );
}

function d4u_svc_secret() {
	return defined( 'D4U_SVC_SECRET' ) ? (string) D4U_SVC_SECRET : (string) get_option( 'd4u_svc_secret', '' );
}

function d4u_svc_on() {
	return '' !== d4u_svc_url() && strlen( d4u_svc_secret() ) >= 32 && 'off' !== get_option( 'd4u_svc_state', 'on' );
}

/** Headers proving the request comes from this WordPress: HMAC-SHA256 of "time.body". */
function d4u_svc_headers( $body ) {
	$ts = (string) time();
	return array(
		'Content-Type'       => 'application/json',
		'X-Dawa4u-Time'      => $ts,
		'X-Dawa4u-Signature' => 'sha256=' . hash_hmac( 'sha256', $ts . '.' . $body, d4u_svc_secret() ),
	);
}

/**
 * Call a service. Short timeout on purpose: a slow VPS must never slow down checkout.
 *
 * @return array|WP_Error
 */
function d4u_svc_call( $method, $path, $data = null, $timeout = 0.8, $query = array() ) {
	if ( ! d4u_svc_on() ) {
		return new WP_Error( 'd4u_svc_off', 'Services are not set up.' );
	}
	$body = null === $data ? '' : wp_json_encode( $data );
	$url  = add_query_arg( $query, d4u_svc_url() . $path );
	$res  = wp_remote_request( $url, array(
		'method'      => $method,
		'timeout'     => $timeout,
		'redirection' => 0,
		'headers'     => d4u_svc_headers( $body ),
		'body'        => 'GET' === $method ? null : $body,
	) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	$json = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code >= 300 || ! is_array( $json ) ) {
		return new WP_Error( 'd4u_svc_http', 'Service answered HTTP ' . $code );
	}
	return $json;
}

/** Fire-and-forget event to Kafka (through the gateway). Collected per request and sent once at the end. */
function d4u_svc_event( $topic, $event, $key = '' ) {
	if ( ! d4u_svc_on() ) {
		return;
	}
	$GLOBALS['d4u_svc_queue'][] = array( 'topic' => $topic, 'key' => (string) $key, 'event' => $event );
	if ( empty( $GLOBALS['d4u_svc_flush'] ) ) {
		$GLOBALS['d4u_svc_flush'] = true;
		add_action( 'shutdown', 'd4u_svc_flush', 1000 ); // after WordPress has flushed the page
	}
}

function d4u_svc_flush() {
	$q = isset( $GLOBALS['d4u_svc_queue'] ) ? $GLOBALS['d4u_svc_queue'] : array();
	$GLOBALS['d4u_svc_queue'] = array();
	if ( ! $q ) {
		return;
	}
	// Let the visitor's browser go first, then talk to the services.
	if ( function_exists( 'litespeed_finish_request' ) ) {
		litespeed_finish_request();
	} elseif ( function_exists( 'fastcgi_finish_request' ) ) {
		fastcgi_finish_request();
	}
	$body = wp_json_encode( $q );
	$res  = wp_remote_post( d4u_svc_url() . '/v1/events', array(
		'timeout' => 3,
		'headers' => d4u_svc_headers( $body ),
		'body'    => $body,
	) );
	if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
		// Keep the last few so a later request can send them again (WordPress stays the record either way).
		$keep = array_slice( array_merge( (array) get_option( 'd4u_svc_retry', array() ), $q ), -200 );
		update_option( 'd4u_svc_retry', $keep, false );
	} elseif ( get_option( 'd4u_svc_retry' ) ) {
		$old = (array) get_option( 'd4u_svc_retry' );
		delete_option( 'd4u_svc_retry' );
		$b2  = wp_json_encode( array_slice( $old, 0, 100 ) );
		wp_remote_post( d4u_svc_url() . '/v1/events', array( 'timeout' => 3, 'headers' => d4u_svc_headers( $b2 ), 'body' => $b2 ) );
	}
}

/** A short-lived token a browser can use with the gateway (rider GPS, live tracking). */
function d4u_svc_token( $scope, $id, $ttl ) {
	$exp = time() + (int) $ttl;
	$raw = $scope . '.' . $id . '.' . $exp;
	return $raw . '.' . hash_hmac( 'sha256', $raw, d4u_svc_secret() );
}

/* ------------------------------------------------------------------ events */

function d4u_svc_order_event( $order, $event = '' ) {
	$items = array();
	foreach ( d4u_order_need( $order ) as $sku => $q ) {
		$items[] = array( 'sku' => $sku, 'qty' => (int) $q );
	}
	$lat = $order->get_meta( '_d4u_lat' );
	$lng = $order->get_meta( '_d4u_lng' );
	return array(
		'event' => $event ? $event : 'order.' . $order->get_status(),
		'order' => array(
			'id'       => (string) $order->get_id(),
			'status'   => $order->get_status(),
			'pin'      => d4u_order_pin( $order ),
			'lat'      => '' !== $lat ? (float) $lat : null,
			'lng'      => '' !== $lng ? (float) $lng : null,
			'pharmacy' => (int) $order->get_meta( '_d4u_pharmacy' ),
			'rider'    => (string) (int) $order->get_meta( '_d4u_rider' ),
			'items'    => $items,
			'paid'     => $order->is_paid(),
			'created'  => $order->get_date_created() ? $order->get_date_created()->getTimestamp() : time(),
			'ts'       => array(
				'processing' => (int) $order->get_meta( '_d4u_t_processing' ),
				'ready'      => (int) $order->get_meta( '_d4u_t_d4u-ready' ),
				'out'        => (int) $order->get_meta( '_d4u_t_d4u-out' ),
				'delivered'  => (int) $order->get_meta( '_d4u_delivered_at' ),
			),
		),
	);
}

add_action( 'woocommerce_order_status_changed', function ( $id, $from, $to, $order = null ) {
	$order = $order instanceof WC_Order ? $order : wc_get_order( $id );
	if ( $order && d4u_svc_on() ) {
		d4u_svc_event( 'orders', d4u_svc_order_event( $order ), $order->get_id() );
	}
}, 40, 4 );

add_action( 'd4u_stock_saved', function ( $uid, $stock ) {
	$items = array();
	foreach ( (array) $stock as $sku => $s ) {
		$items[ $sku ] = (int) $s['qty'];
	}
	d4u_svc_event( 'stock', array( 'event' => 'stock.snapshot', 'pharmacy' => (int) $uid, 'items' => $items ), $uid );
}, 10, 2 );

/* ------------------------------------------------------------------ the last strip: hold in Redis */

/**
 * Ask stock-svc to hold this order's medicines at the first pharmacy (best first) that has all of them.
 *
 * @return int|null the pharmacy, or null to let WordPress decide on its own
 */
function d4u_svc_hold( $order, $ranked, $need ) {
	if ( ! d4u_svc_on() || ! $need || ! $ranked ) {
		return null;
	}
	$res = d4u_svc_call( 'POST', '/v1/stock/hold', array(
		'order'      => (string) $order->get_id(),
		'pharmacies' => array_map( 'intval', wp_list_pluck( $ranked, 'id' ) ),
		'items'      => array_map( 'intval', $need ),
		'paid'       => false,
	), 0.8 );
	if ( is_wp_error( $res ) ) {
		$order->add_order_note( 'Stock service did not answer (' . $res->get_error_message() . ') — WordPress chose the pharmacy.' );
		return null;
	}
	if ( ! empty( $res['pharmacy'] ) ) {
		if ( ! empty( $res['held'] ) ) {
			$order->update_meta_data( '_d4u_svc_held', 1 );
		}
		return (int) $res['pharmacy'];
	}
	return null; // nobody has everything: WordPress sends it to the best one, who can pass it on
}

/* ------------------------------------------------------------------ delivery times and forecast from the services */

function d4u_svc_eta( $pin, $lat = null, $lng = null ) {
	$key = 'd4u_svc_eta_' . md5( $pin . '|' . $lat . '|' . $lng );
	$c   = get_transient( $key );
	if ( is_array( $c ) ) {
		return $c;
	}
	$q   = array_filter( array( 'pin' => $pin, 'lat' => $lat, 'lng' => $lng ), function ( $v ) {
		return null !== $v && '' !== $v;
	} );
	$res = d4u_svc_call( 'GET', '/v1/eta', null, 0.6, $q );
	if ( is_wp_error( $res ) || ! isset( $res['minutes'] ) ) {
		return null;
	}
	set_transient( $key, $res, MINUTE_IN_SECONDS );
	return $res;
}

function d4u_svc_forecast( $pins ) {
	$key = 'd4u_svc_fc_' . md5( implode( ',', (array) $pins ) );
	$c   = get_transient( $key );
	if ( is_array( $c ) ) {
		return $c;
	}
	$res = d4u_svc_call( 'GET', '/v1/forecast', null, 2, array( 'pins' => implode( ',', (array) $pins ) ) );
	if ( is_wp_error( $res ) || ! isset( $res['medicines'] ) ) {
		return null;
	}
	set_transient( $key, $res, 30 * MINUTE_IN_SECONDS );
	return $res;
}

/* ------------------------------------------------------------------ customer location at checkout (optional) */

add_action( 'woocommerce_review_order_before_submit', function () {
	if ( ! d4u_svc_on() ) {
		return;
	}
	echo '<div class="d4u-locate"><input type="hidden" name="d4u_lat" id="d4u-lat"><input type="hidden" name="d4u_lng" id="d4u-lng">';
	echo '<button type="button" class="button d4u-locate__btn" id="d4u-locate">Use my location for a sharper delivery time</button><span class="d4u-locate__msg" id="d4u-locate-msg">Optional. Your rider still uses your address.</span></div>';
	echo "<script>(function(){var b=document.getElementById('d4u-locate'),m=document.getElementById('d4u-locate-msg');if(!b||!navigator.geolocation){if(b)b.style.display='none';return}b.addEventListener('click',function(){m.textContent='Finding you…';navigator.geolocation.getCurrentPosition(function(p){document.getElementById('d4u-lat').value=p.coords.latitude.toFixed(6);document.getElementById('d4u-lng').value=p.coords.longitude.toFixed(6);m.textContent='Location added ✓';b.disabled=true},function(){m.textContent='Location not shared — that’s fine.'},{enableHighAccuracy:true,timeout:10000})})})();</script>";
} );

add_action( 'woocommerce_checkout_create_order', function ( $order ) {
	$lat = isset( $_POST['d4u_lat'] ) ? (float) $_POST['d4u_lat'] : 0; // phpcs:ignore
	$lng = isset( $_POST['d4u_lng'] ) ? (float) $_POST['d4u_lng'] : 0; // phpcs:ignore
	if ( $lat && $lng && abs( $lat ) <= 90 && abs( $lng ) <= 180 ) {
		$order->update_meta_data( '_d4u_lat', round( $lat, 6 ) );
		$order->update_meta_data( '_d4u_lng', round( $lng, 6 ) );
	}
} );

/* ------------------------------------------------------------------ live tracking for the customer */

add_action( 'woocommerce_order_details_after_order_table', function ( $order ) {
	if ( ! d4u_svc_on() || ! $order->has_status( array( 'processing', 'd4u-ready', 'd4u-out' ) ) ) {
		return;
	}
	$cfg = array(
		'url'   => d4u_svc_url() . '/v1/track/' . $order->get_id(),
		'token' => d4u_svc_token( 'track', $order->get_id(), 6 * HOUR_IN_SECONDS ),
	);
	echo '<script>(function(c){var el=document.querySelector(".d4u-eta");if(!el)return;function fmt(t){return new Date(t*1000).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}';
	echo 'function tick(){if(document.hidden)return;fetch(c.url+"?t="+encodeURIComponent(c.token)).then(function(r){return r.ok?r.json():null}).then(function(d){if(!d)return;var s=d.raining?" It’s raining, so riders are taking a few extra minutes.":"";';
	echo 'if(d.status==="d4u-out"){el.textContent=(d.soon?"Arriving soon.":"Arriving in about "+d.minutes+" min.")+s}else if(d.by){el.textContent="Expected by "+fmt(d.by)+"."+s}if(d.status==="completed")location.reload()}).catch(function(){})}';
	echo 'tick();setInterval(tick,15000)})(' . wp_json_encode( $cfg ) . ');</script>';
} );

/* ------------------------------------------------------------------ rider GPS while delivering */

add_filter( 'do_shortcode_tag', function ( $out, $tag ) {
	if ( 'dawa4u_rider' !== $tag || ! d4u_svc_on() || ! is_user_logged_in() ) {
		return $out;
	}
	$uid = get_current_user_id();
	if ( ! d4u_is_rider( $uid ) || ! d4u_orders_for( '_d4u_rider', $uid, array( 'd4u-out' ) ) ) {
		return $out;
	}
	$cfg = array(
		'url'   => d4u_svc_url() . '/v1/rider/location',
		'token' => d4u_svc_token( 'rider', $uid, 12 * HOUR_IN_SECONDS ),
	);
	$out .= '<p class="d4u-small d4u-gps" id="d4u-gps">Sharing your live location with the customer while you deliver.</p>';
	$out .= '<script>(function(c){if(!navigator.geolocation)return;var last=0,el=document.getElementById("d4u-gps");navigator.geolocation.watchPosition(function(p){var n=Date.now();if(n-last<8000)return;last=n;';
	$out .= 'fetch(c.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({t:c.token,lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy})}).catch(function(){})},function(){if(el)el.textContent="Turn on location so the customer can see you coming."},{enableHighAccuracy:true,maximumAge:5000,timeout:20000})})(' . wp_json_encode( $cfg ) . ');</script>';
	return $out;
}, 10, 2 );

/* ------------------------------------------------------------------ settings (WooCommerce → dawa4u partners) */

function d4u_svc_settings_html() {
	$url   = d4u_svc_url();
	$fixed = defined( 'D4U_SVC_URL' ) || defined( 'D4U_SVC_SECRET' );
	$out   = '<h2 style="margin-top:32px">Services (Kafka, Redis, microservices)</h2>';
	if ( $fixed ) {
		$out .= '<p>Set in the server configuration' . ( $url ? ': <code>' . esc_html( $url ) . '</code>' : '' ) . '.</p>';
	}
	$health = d4u_svc_on() ? d4u_svc_call( 'GET', '/health', null, 2 ) : null;
	if ( is_array( $health ) ) {
		$bits = array();
		foreach ( array( 'stock', 'eta', 'forecast' ) as $k ) {
			$bits[] = $k . ' ' . ( ! empty( $health[ $k ] ) ? '✓' : '✗' );
		}
		$out .= '<p><strong style="color:#15803d">Connected</strong> — event bus: ' . esc_html( isset( $health['bus'] ) ? $health['bus'] : '?' ) . ' · ' . esc_html( implode( ' · ', $bits ) ) . '</p>';
	} elseif ( d4u_svc_on() ) {
		$out .= '<p><strong style="color:#b42318">Not answering</strong> — ' . esc_html( $health->get_error_message() ) . '. dawa4u keeps working on its own meanwhile.</p>';
	} else {
		$out .= '<p>Not set up. dawa4u works fully without it; the services add Redis stock holds, the Kafka event stream, live rider tracking and the learned forecast.</p>';
	}
	if ( ! $fixed ) {
		$out .= '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">' . wp_nonce_field( 'd4u_svc', '_wpnonce', true, false ) . '<input type="hidden" name="action" value="d4u_svc">';
		$out .= '<p><label>Gateway address <input name="url" type="url" class="regular-text" placeholder="https://api.dawa4u.in" value="' . esc_attr( $url ) . '"></label></p>';
		$out .= '<p>' . ( get_option( 'd4u_svc_secret' ) ? 'Shared secret is set. ' : '' ) . '<label><input type="checkbox" name="new_secret" value="1"> Make a new shared secret</label> <span class="description">Shown once — put it in the services’ <code>D4U_SECRET</code>.</span></p>';
		$out .= get_submit_button( 'Save services', 'secondary' ) . '</form>';
		$new = get_transient( 'd4u_svc_newsecret' );
		if ( $new ) {
			delete_transient( 'd4u_svc_newsecret' );
			$out .= '<p><strong>New shared secret (copy it now):</strong> <code>' . esc_html( $new ) . '</code></p>';
		}
	}
	return $out;
}

add_action( 'admin_post_d4u_svc', function () {
	if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'd4u_svc' ) ) {
		wp_die( 'Not allowed.' );
	}
	$url = isset( $_POST['url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['url'] ) ), array( 'https' ) ) : ''; // phpcs:ignore
	update_option( 'd4u_svc_url', $url, false );
	if ( ! empty( $_POST['new_secret'] ) || ! get_option( 'd4u_svc_secret' ) ) {
		$s = wp_generate_password( 48, false, false );
		update_option( 'd4u_svc_secret', $s, false );
		set_transient( 'd4u_svc_newsecret', $s, 10 * MINUTE_IN_SECONDS );
	}
	wp_safe_redirect( admin_url( 'admin.php?page=d4u-partners&done=1' ) );
	exit;
} );
