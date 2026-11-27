<?php
/**
 * Cart and checkout: delivery + handling charges, dawaPass savings, PIN check,
 * prescription upload, and what happens right after an order is placed.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ------------------------------------------------------------------ address fields */

add_filter( 'woocommerce_default_address_fields', function ( $f ) {
	unset( $f['company'] );
	if ( isset( $f['address_1'] ) ) {
		$f['address_1']['label']       = 'House, street and area';
		$f['address_1']['placeholder'] = 'House no., street, area';
	}
	if ( isset( $f['address_2'] ) ) {
		$f['address_2']['label']       = 'Landmark';
		$f['address_2']['label_class'] = array();
		$f['address_2']['placeholder'] = 'Near …';
	}
	return $f;
} );

add_filter( 'woocommerce_get_country_locale', function ( $l ) {
	$l['IN']['postcode']['label'] = 'PIN code';
	return $l;
} );

add_filter( 'woocommerce_checkout_fields', function ( $f ) {
	if ( isset( $f['billing']['billing_phone'] ) ) {
		$f['billing']['billing_phone']['required'] = true;
		$f['billing']['billing_phone']['label']    = 'Mobile number';
	}
	if ( isset( $f['order']['order_comments'] ) ) {
		$f['order']['order_comments']['label']       = 'Note for the pharmacy or rider';
		$f['order']['order_comments']['placeholder'] = 'For example: call me when you reach the gate';
	}
	return $f;
} );

/* ------------------------------------------------------------------ charges */

function d4u_cart_medicine_subtotal( $cart ) {
	$sub = 0;
	foreach ( $cart->get_cart() as $item ) {
		if ( d4u_is_pass_product( $item['product_id'] ) || empty( $item['data'] ) ) {
			continue;
		}
		$sub += (float) $item['data']->get_price() * (int) $item['quantity'];
	}
	return $sub;
}

function d4u_pass_applies() {
	return d4u_has_pass() || d4u_cart_has_pass();
}

add_action( 'woocommerce_cart_calculate_fees', function ( $cart ) {
	if ( is_admin() && ! wp_doing_ajax() ) {
		return;
	}
	$sub = d4u_cart_medicine_subtotal( $cart );
	if ( $sub <= 0 ) {
		return;
	}
	$hand = (float) d4u_opt( 'handling_fee' );
	if ( $hand > 0 ) {
		$cart->add_fee( 'Handling', $hand, false );
	}
	if ( d4u_pass_applies() ) {
		$off = round( $sub * (float) d4u_opt( 'pass_off' ) / 100 );
		if ( $off > 0 ) {
			$cart->add_fee( sprintf( 'dawaPass savings (%s%%)', d4u_opt( 'pass_off' ) ), -$off, false );
		}
	}
} );

// Delivery is free with dawaPass. The flag in the package makes WooCommerce recalculate when dawaPass is added.
add_filter( 'woocommerce_cart_shipping_packages', function ( $packages ) {
	foreach ( $packages as $i => $p ) {
		$packages[ $i ]['d4u_pass'] = d4u_pass_applies() ? 1 : 0;
	}
	return $packages;
} );

add_filter( 'woocommerce_shipping_package_name', function () {
	return 'Delivery';
} );

add_filter( 'woocommerce_package_rates', function ( $rates, $package ) {
	$free = ! empty( $package['d4u_pass'] );
	foreach ( $rates as $id => $rate ) {
		if ( 'flat_rate' !== $rate->get_method_id() ) {
			continue;
		}
		$rate->set_cost( $free ? 0 : (float) d4u_opt( 'delivery_fee' ) );
		$rate->set_label( $free ? 'Free with dawaPass' : 'Home delivery' );
		$rate->set_taxes( array() );
	}
	return $rates;
}, 20, 2 );

/* ------------------------------------------------------------------ dawaPass prompts */

function d4u_pass_box() {
	if ( ! WC()->cart || WC()->cart->is_empty() ) {
		return;
	}
	if ( d4u_has_pass() ) {
		$until = d4u_pass_until( get_current_user_id() );
		echo '<div class="d4u-passbar is-on"><strong>dawaPass is on</strong> until ' . esc_html( date_i18n( 'j M Y', $until ) ) . ' — ' . esc_html( d4u_opt( 'pass_off' ) ) . '% off and free delivery are applied.</div>';
		return;
	}
	if ( d4u_cart_has_pass() ) {
		echo '<div class="d4u-passbar is-on"><strong>dawaPass is in your cart</strong> — ' . esc_html( d4u_opt( 'pass_off' ) ) . '% off and free delivery are already applied to this order.</div>';
		return;
	}
	$sub  = d4u_cart_medicine_subtotal( WC()->cart );
	$save = round( $sub * (float) d4u_opt( 'pass_off' ) / 100 ) + (float) d4u_opt( 'delivery_fee' );
	$pid  = d4u_pass_product_id();
	if ( ! $pid || $sub <= 0 ) {
		return;
	}
	$url = add_query_arg( 'add-to-cart', $pid, wc_get_cart_url() );
	echo '<div class="d4u-passbar"><div><strong>Save ' . esc_html( d4u_inr( $save ) ) . ' on this order with dawaPass</strong><br><span>' . esc_html( d4u_opt( 'pass_off' ) ) . '% off medicines and free delivery for 30 days — ₹100.</span></div><a class="button d4u-btn-gold" href="' . esc_url( $url ) . '">Add dawaPass</a></div>';
}
add_action( 'woocommerce_before_cart', 'd4u_pass_box', 5 );
add_action( 'woocommerce_before_checkout_form', 'd4u_pass_box', 5 );

/* ------------------------------------------------------------------ product badges */

add_action( 'woocommerce_after_shop_loop_item_title', function () {
	global $product;
	if ( ! $product ) {
		return;
	}
	$line = trim( get_post_meta( $product->get_id(), '_d4u_salt', true ) . ' · ' . get_post_meta( $product->get_id(), '_d4u_pack', true ), ' ·' );
	if ( $line ) {
		echo '<span class="d4u-salt">' . esc_html( $line ) . '</span>';
	}
	if ( d4u_needs_rx( $product ) ) {
		echo '<span class="d4u-rx-tag">Needs prescription</span>';
	}
}, 5 );

add_action( 'woocommerce_single_product_summary', function () {
	global $product;
	if ( $product && d4u_needs_rx( $product ) ) {
		echo '<p class="d4u-rx-note"><strong>Needs a prescription.</strong> Add a photo of it at checkout. A licensed pharmacist checks it before your order is packed.</p>';
	}
}, 25 );

/* ------------------------------------------------------------------ "Is it available near me?" — checks every pharmacy for the PIN */

/** What we can honestly say about one medicine at one PIN. */
function d4u_availability( $product, $pin ) {
	$pin = preg_replace( '/\D/', '', (string) $pin );
	if ( 6 !== strlen( $pin ) ) {
		return array( 'state' => 'bad', 'text' => 'Enter your 6-digit PIN code.' );
	}
	$list = d4u_rank_pharmacies( $pin, array( $product->get_sku() => 1 ) );
	if ( ! $list ) {
		d4u_note_missed_pin( $pin );
		return array( 'state' => 'none', 'text' => sprintf( 'We don’t deliver to %s yet. We are adding pharmacies every week.', $pin ) );
	}
	$eta  = ' Usually delivered in about ' . d4u_eta_minutes( $pin ) . ' min' . ( d4u_raining() ? ' (a little longer — it’s raining)' : '' ) . '.';
	$have = 0;
	$open = 0;
	$know = 0;
	foreach ( $list as $p ) {
		$have += 'full' === $p['stock'] ? 1 : 0;
		$know += 'unknown' === $p['stock'] ? 0 : 1;
		$open += $p['open'] ? 1 : 0;
	}
	$n = count( $list );
	if ( $have ) {
		return array( 'state' => 'yes', 'text' => sprintf( 'In stock at %d of %d pharmac%s delivering to %s.', $have, $n, 1 === $n ? 'y' : 'ies', $pin ) . $eta );
	}
	if ( $know === $n ) {
		return array( 'state' => 'out', 'text' => sprintf( 'Out of stock at the %d pharmac%s near %s right now. You can still order — we ask every pharmacy near you, and tell you if none has it.', $n, 1 === $n ? 'y' : 'ies', $pin ) );
	}
	return array( 'state' => 'maybe', 'text' => sprintf( '%d pharmac%s deliver%s to %s. If the first one doesn’t have it, your order goes to the next one.', $n, 1 === $n ? 'y' : 'ies', 1 === $n ? 's' : '', $pin ) . ( $open ? $eta : ' (All are closed right now.)' ) );
}

add_action( 'wc_ajax_d4u_avail', function () {
	nocache_headers();
	$product = wc_get_product( isset( $_GET['product'] ) ? absint( $_GET['product'] ) : 0 ); // phpcs:ignore
	if ( ! $product || 'publish' !== $product->get_status() || d4u_is_pass_product( $product->get_id() ) ) {
		wp_send_json_error( null, 404 );
	}
	wp_send_json_success( d4u_availability( $product, isset( $_GET['pin'] ) ? sanitize_text_field( wp_unslash( $_GET['pin'] ) ) : '' ) ); // phpcs:ignore
} );

add_action( 'woocommerce_single_product_summary', function () {
	global $product;
	if ( ! $product || d4u_is_pass_product( $product->get_id() ) || ! d4u_partners( 'd4u_pharmacy' ) ) {
		return;
	}
	$url = add_query_arg( 'product', $product->get_id(), WC_AJAX::get_endpoint( 'd4u_avail' ) );
	echo '<form class="d4u-avail" data-url="' . esc_url( $url ) . '" novalidate><label for="d4u-avail-pin">Check near you</label><div class="d4u-avail__row"><input id="d4u-avail-pin" name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="Your PIN code" autocomplete="postal-code"><button type="submit" class="button">Check</button></div><p class="d4u-avail__msg" role="status" aria-live="polite"></p></form>';
	echo "<script>(function(){var f=document.querySelector('.d4u-avail');if(!f)return;var i=f.querySelector('input'),m=f.querySelector('.d4u-avail__msg');function go(){var p=(i.value||'').replace(/\\D/g,'');if(p.length!==6){m.className='d4u-avail__msg is-bad';m.textContent='Enter your 6-digit PIN code.';return}try{localStorage.setItem('d4u-pin',p)}catch(e){}m.className='d4u-avail__msg';m.textContent='Checking every pharmacy near '+p+'…';fetch(f.dataset.url+'&pin='+p,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(r){if(!r||!r.success)throw 0;m.className='d4u-avail__msg is-'+r.data.state;m.textContent=r.data.text}).catch(function(){m.className='d4u-avail__msg is-bad';m.textContent='Could not check right now. Please try again.'})}f.addEventListener('submit',function(e){e.preventDefault();go()});try{var s=localStorage.getItem('d4u-pin');if(s){i.value=s;go()}}catch(e){}})();</script>";
}, 26 );

add_filter( 'woocommerce_cart_item_name', function ( $name, $item ) {
	if ( ! empty( $item['data'] ) && d4u_needs_rx( $item['data'] ) ) {
		$name .= ' <span class="d4u-rx-tag">Needs prescription</span>';
	}
	return $name;
}, 10, 2 );

/* ------------------------------------------------------------------ prescription upload at checkout */

function d4u_session_tokens() {
	if ( ! WC()->session ) {
		return array();
	}
	$t = WC()->session->get( 'd4u_rx_tokens', array() );
	return is_array( $t ) ? $t : array();
}

/** Tokens posted with the checkout form that really belong to this visitor and still have a file. */
function d4u_valid_tokens( $posted ) {
	$mine = d4u_session_tokens();
	$out  = array();
	foreach ( explode( ',', (string) $posted ) as $t ) {
		$t = preg_replace( '/[^a-f0-9]/', '', $t );
		if ( $t && in_array( $t, $mine, true ) && get_transient( 'd4u_rxt_' . $t ) ) {
			$out[] = $t;
		}
	}
	return array_values( array_unique( $out ) );
}

add_action( 'woocommerce_after_order_notes', function () {
	$names = d4u_cart_rx_names();
	if ( ! $names ) {
		return;
	}
	$tokens = array();
	echo '<div class="d4u-rxbox" id="d4u-rxbox">';
	echo '<h3>Prescription</h3>';
	echo '<p>These need a valid prescription: <strong>' . esc_html( implode( ', ', $names ) ) . '</strong>. Add a clear photo or PDF of it. A licensed pharmacist checks it before your order is packed. If it is not accepted, your order is cancelled and any payment is refunded.</p>';
	echo '<label class="d4u-file"><input type="file" id="d4u-rx-file" accept="image/*,application/pdf" multiple><span>Add photo or PDF</span></label>';
	echo '<ul class="d4u-rx-list" id="d4u-rx-list">';
	foreach ( d4u_session_tokens() as $t ) {
		$f = get_transient( 'd4u_rxt_' . $t );
		if ( is_array( $f ) ) {
			$tokens[] = $t;
			echo '<li data-token="' . esc_attr( $t ) . '"><span>' . esc_html( $f['name'] ) . '</span> <button type="button" class="d4u-rx-del">Remove</button></li>';
		}
	}
	echo '</ul>';
	echo '<input type="hidden" name="d4u_rx_tokens" id="d4u-rx-tokens" value="' . esc_attr( implode( ',', $tokens ) ) . '">';
	echo '<p class="d4u-rx-msg" id="d4u-rx-msg" role="status"></p>';
	echo '</div>';
} );

add_action( 'wp_enqueue_scripts', function () {
	if ( ! function_exists( 'is_checkout' ) || ! is_checkout() || is_order_received_page() ) {
		return;
	}
	wp_enqueue_script( 'dawa4u-checkout', D4U_URL . 'assets/checkout.js', array(), D4U_VER, true );
	wp_localize_script( 'dawa4u-checkout', 'd4uRx', array(
		'up'    => WC_AJAX::get_endpoint( 'd4u_rx_upload' ),
		'del'   => WC_AJAX::get_endpoint( 'd4u_rx_remove' ),
		'nonce' => wp_create_nonce( 'd4u_rx_up' ),
	) );
} );

add_action( 'wc_ajax_d4u_rx_upload', function () {
	if ( ! check_ajax_referer( 'd4u_rx_up', 'nonce', false ) ) {
		wp_send_json_error( array( 'message' => 'This page expired. Please reload it and try again.' ) );
	}
	if ( ! WC()->session ) {
		wp_send_json_error( array( 'message' => 'Please reload the page and try again.' ) );
	}
	if ( ! WC()->session->has_session() ) {
		WC()->session->set_customer_session_cookie( true );
	}
	$tokens = d4u_session_tokens();
	if ( count( $tokens ) >= 5 ) {
		wp_send_json_error( array( 'message' => 'You can add up to 5 files.' ) );
	}
	if ( empty( $_FILES['file'] ) ) { // phpcs:ignore
		wp_send_json_error( array( 'message' => 'Choose a photo or PDF.' ) );
	}
	$r = d4u_store_rx_file( $_FILES['file'] ); // phpcs:ignore
	if ( is_wp_error( $r ) ) {
		wp_send_json_error( array( 'message' => $r->get_error_message() ) );
	}
	$token = bin2hex( random_bytes( 12 ) );
	set_transient( 'd4u_rxt_' . $token, $r, 2 * DAY_IN_SECONDS );
	$tokens[] = $token;
	WC()->session->set( 'd4u_rx_tokens', $tokens );
	wp_send_json_success( array( 'token' => $token, 'name' => $r['name'] ) );
} );

add_action( 'wc_ajax_d4u_rx_remove', function () {
	if ( ! check_ajax_referer( 'd4u_rx_up', 'nonce', false ) || ! WC()->session ) {
		wp_send_json_error();
	}
	$t      = isset( $_POST['token'] ) ? preg_replace( '/[^a-f0-9]/', '', sanitize_text_field( wp_unslash( $_POST['token'] ) ) ) : ''; // phpcs:ignore
	$tokens = d4u_session_tokens();
	if ( $t && in_array( $t, $tokens, true ) ) {
		$f = get_transient( 'd4u_rxt_' . $t );
		if ( is_array( $f ) && ! empty( $f['path'] ) && false === strpos( $f['path'], '..' ) ) {
			@unlink( d4u_rx_dir() . '/' . $f['path'] ); // phpcs:ignore
		}
		delete_transient( 'd4u_rxt_' . $t );
		WC()->session->set( 'd4u_rx_tokens', array_values( array_diff( $tokens, array( $t ) ) ) );
	}
	wp_send_json_success();
} );

/* ------------------------------------------------------------------ checks before the order is placed */

add_action( 'woocommerce_after_checkout_validation', function ( $data, $errors ) {
	$cart = WC()->cart;
	if ( ! $cart ) {
		return;
	}
	$phone = preg_replace( '/\D/', '', isset( $data['billing_phone'] ) ? $data['billing_phone'] : '' );
	$phone = substr( $phone, -10 );
	if ( ! preg_match( '/^[6-9]\d{9}$/', $phone ) ) {
		$errors->add( 'd4u_phone', 'Please enter a 10-digit mobile number so the rider can call you.' );
	}
	if ( $cart->needs_shipping() ) {
		$pin = preg_replace( '/\D/', '', isset( $data['billing_postcode'] ) ? $data['billing_postcode'] : '' );
		if ( 6 !== strlen( $pin ) ) {
			$errors->add( 'd4u_pin', 'Please enter your 6-digit PIN code.' );
		} elseif ( d4u_pin_check_on() && ! d4u_find_pharmacy( $pin ) ) {
			d4u_note_missed_pin( $pin );
			/* translators: %s: PIN code */
			$errors->add( 'd4u_pin', sprintf( 'Sorry, we don’t deliver to PIN %s yet. We are adding pharmacies every week.', esc_html( $pin ) ) );
		}
	}
	$names = d4u_cart_rx_names();
	if ( $names ) {
		$posted = isset( $_POST['d4u_rx_tokens'] ) ? sanitize_text_field( wp_unslash( $_POST['d4u_rx_tokens'] ) ) : ''; // phpcs:ignore
		if ( ! d4u_valid_tokens( $posted ) ) {
			$errors->add( 'd4u_rx', 'Please add a photo or PDF of your prescription for: ' . esc_html( implode( ', ', $names ) ) . '.' );
		}
	}
}, 10, 2 );

/* ------------------------------------------------------------------ after the order is placed */

add_action( 'woocommerce_checkout_order_processed', function ( $order_id, $posted = array(), $order = null ) {
	if ( ! $order instanceof WC_Order ) {
		$order = wc_get_order( $order_id );
	}
	if ( ! $order ) {
		return;
	}
	if ( d4u_order_has_rx_items( $order ) ) {
		$posted_tokens = isset( $_POST['d4u_rx_tokens'] ) ? sanitize_text_field( wp_unslash( $_POST['d4u_rx_tokens'] ) ) : ''; // phpcs:ignore
		$files         = array();
		foreach ( d4u_valid_tokens( $posted_tokens ) as $t ) {
			$f = get_transient( 'd4u_rxt_' . $t );
			if ( is_array( $f ) ) {
				$files[] = $f;
			}
			delete_transient( 'd4u_rxt_' . $t );
		}
		if ( $files ) {
			$order->update_meta_data( '_d4u_rx_files', $files );
		}
		$order->update_meta_data( '_d4u_rx_state', 'pending' );
		if ( WC()->session ) {
			WC()->session->set( 'd4u_rx_tokens', array() );
		}
	}
	d4u_prepare_order( $order );
	$order->save();
}, 10, 3 );

// Orders with prescription medicines wait for the pharmacist before packing.
add_filter( 'woocommerce_cod_process_payment_order_status', function ( $status, $order = null ) {
	if ( $order instanceof WC_Order && d4u_rx_pending( $order ) ) {
		return 'd4u-rx';
	}
	return $status;
}, 10, 2 );

add_filter( 'woocommerce_payment_complete_order_status', function ( $status, $order_id = 0, $order = null ) {
	if ( ! $order instanceof WC_Order ) {
		$order = wc_get_order( $order_id );
	}
	if ( ! $order ) {
		return $status;
	}
	if ( d4u_order_only_pass( $order ) ) {
		return 'completed';
	}
	if ( d4u_rx_pending( $order ) ) {
		return 'd4u-rx';
	}
	return $status;
}, 10, 3 );

// Online payment (Cashfree: UPI, cards, net banking) first at checkout, then the rest.
add_filter( 'woocommerce_available_payment_gateways', function ( $gateways ) {
	if ( is_array( $gateways ) && isset( $gateways['cashfree'] ) ) {
		$gateways = array( 'cashfree' => $gateways['cashfree'] ) + $gateways;
	}
	return $gateways;
}, 20 );

// Customers know "UPI", not "Cashfree": clearer words, unless the owner wrote their own in the settings.
add_filter( 'woocommerce_gateway_title', function ( $title, $id = '' ) {
	return ( 'cashfree' === $id && in_array( trim( (string) $title ), array( '', 'Cashfree', 'Cashfree Payments' ), true ) ) ? 'Pay now — UPI, card or net banking' : $title;
}, 10, 2 );
add_filter( 'woocommerce_gateway_description', function ( $desc, $id = '' ) {
	return ( 'cashfree' === $id && ( '' === trim( (string) $desc ) || false !== stripos( $desc, 'via Cashfree' ) ) ) ? 'GPay, PhonePe, Paytm or any UPI app, debit or credit card, or net banking. Secured by Cashfree.' : $desc;
}, 10, 2 );

// UPI payments are confirmed by hand (On hold → Processing). Then the same rules apply.
add_action( 'woocommerce_order_status_on-hold_to_processing', function ( $order_id, $order = null ) {
	if ( ! $order instanceof WC_Order ) {
		$order = wc_get_order( $order_id );
	}
	if ( ! $order ) {
		return;
	}
	if ( d4u_order_only_pass( $order ) ) {
		$order->update_status( 'completed', 'dawaPass paid.' );
	} elseif ( d4u_rx_pending( $order ) ) {
		$order->update_status( 'd4u-rx', 'Payment confirmed. Waiting for the pharmacist to check the prescription.' );
	}
}, 20, 2 );

/* ------------------------------------------------------------------ my account */

add_filter( 'woocommerce_account_menu_items', function ( $items ) {
	unset( $items['downloads'] );
	return $items;
} );

/* ------------------------------------------------------------------ my account: dawaPass */

add_action( 'woocommerce_account_dashboard', function () {
	$uid = get_current_user_id();
	if ( d4u_has_pass( $uid ) ) {
		echo '<div class="d4u-passbar is-on"><strong>dawaPass is on</strong> until ' . esc_html( date_i18n( 'j M Y', d4u_pass_until( $uid ) ) ) . '. You get ' . esc_html( d4u_opt( 'pass_off' ) ) . '% off and free delivery.</div>';
	} elseif ( d4u_pass_product_id() ) {
		echo '<div class="d4u-passbar"><div><strong>Join dawaPass</strong><br><span>' . esc_html( d4u_opt( 'pass_off' ) ) . '% off medicines and free delivery for 30 days — ₹100.</span></div><a class="button d4u-btn-gold" href="' . esc_url( add_query_arg( 'add-to-cart', d4u_pass_product_id(), wc_get_cart_url() ) ) . '">Join dawaPass</a></div>';
	}
	echo '<p class="d4u-account-links"><a class="button" href="' . esc_url( wc_get_page_permalink( 'shop' ) ) . '">Order medicines</a> <a class="button" href="' . esc_url( d4u_page_url( 'rx' ) ) . '">Upload prescription</a></p>';
} );
