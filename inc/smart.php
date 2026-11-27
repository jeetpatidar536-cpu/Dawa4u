<?php
/**
 * How the 10-minute apps run, scaled to dawa4u's partner pharmacies:
 *
 *  - Lock the last strip: stock is held for an order the moment it is placed (one checkout at a time
 *    per pharmacy), so two customers can't both get the last strip. Unpaid orders let go after 30 minutes.
 *  - First expired, first out: stock files carry batches and expiry dates; the packer is told which batch
 *    to pick, expired stock is never counted, and stock near expiry is flagged.
 *  - Restock forecast: what customers near each pharmacy will likely order next week, against its stock.
 *  - Zones: delivery time per PIN code and PIN codes people tried to order from — where to add a pharmacy.
 *  - Honest ETAs: from real delivery times per PIN, plus a buffer when it rains, and "Arriving soon"
 *    for the last stretch instead of a countdown that goes wrong.
 *  - In demand this week: what people near you order most, at the front of the medicine list.
 *  - Packing clock: each order shows how long it has waited; the dashboard shows average packing time.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ================================================================== locks */

/**
 * A short lock (a mutex) that works on any WordPress database: a plain INSERT on the options table
 * fails when the row already exists (option_name is unique), so only one request at a time can hold it.
 * (add_option() can't be used: it quietly updates an existing row.) Locks left by a crashed request expire.
 */
function d4u_lock( $name, $wait = 5 ) {
	global $wpdb;
	$key  = 'd4u_lock_' . $name;
	$stop = microtime( true ) + $wait;
	do {
		$prev = $wpdb->suppress_errors( true );
		$ok   = $wpdb->query( $wpdb->prepare( "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')", $key, (string) ( time() + 20 ) ) ); // phpcs:ignore
		$wpdb->suppress_errors( $prev );
		if ( $ok ) {
			wp_cache_delete( $key, 'options' );
			return true;
		}
		$until = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $key ) ); // phpcs:ignore
		if ( null !== $until && (int) $until < time() ) {
			$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", $key, $until ) ); // phpcs:ignore
			continue;
		}
		usleep( 100000 );
	} while ( microtime( true ) < $stop );
	return false;
}

function d4u_unlock( $name ) {
	global $wpdb;
	$wpdb->delete( $wpdb->options, array( 'option_name' => 'd4u_lock_' . $name ) );
	wp_cache_delete( 'd4u_lock_' . $name, 'options' );
}

/** Inside a lock, read stock straight from the database, not from this request's cache. */
function d4u_fresh_meta( $ids ) {
	foreach ( (array) $ids as $id ) {
		wp_cache_delete( (int) $id, 'user_meta' );
	}
}

/* ================================================================== batches and expiry */

/** "12/27", "12/2027", "Dec-27", "31/12/2027", "2027-12-31", Excel date numbers → "2027-12". '' if unknown. */
function d4u_parse_expiry( $raw ) {
	$s = strtolower( trim( (string) $raw ) );
	if ( '' === $s ) {
		return '';
	}
	if ( preg_match( '/^\d{5}(\.\d+)?$/', $s ) ) { // Excel stores dates as days since 30 Dec 1899
		$t = ( (int) $s - 25569 ) * DAY_IN_SECONDS;
		return gmdate( 'Y-m', $t );
	}
	$year = function ( $y ) {
		$y = (int) $y;
		return $y < 100 ? 2000 + $y : $y;
	};
	if ( preg_match( '/^(\d{4})[\/\-.](\d{1,2})([\/\-.]\d{1,2})?/', $s, $m ) ) {
		$y  = (int) $m[1];
		$mo = (int) $m[2];
	} elseif ( preg_match( '/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/', $s, $m ) ) {
		$y  = $year( $m[3] );
		$mo = (int) $m[2];
	} elseif ( preg_match( '/^(\d{1,2})[\/\-.\s](\d{2,4})$/', $s, $m ) ) {
		$y  = $year( $m[2] );
		$mo = (int) $m[1];
	} elseif ( preg_match( '/^([a-z]{3})[a-z]*[\/\-.\s\']*(\d{2,4})$/', $s, $m ) ) {
		$months = array( 'jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12 );
		if ( ! isset( $months[ $m[1] ] ) ) {
			return '';
		}
		$y  = $year( $m[2] );
		$mo = $months[ $m[1] ];
	} else {
		return '';
	}
	return ( $mo >= 1 && $mo <= 12 && $y >= 2000 && $y <= 2100 ) ? sprintf( '%04d-%02d', $y, $mo ) : '';
}

/** Medicines are good until the end of their expiry month. */
function d4u_is_expired( $ym ) {
	return '' !== $ym && $ym < current_time( 'Y-m' );
}

function d4u_expiry_soon( $ym, $months = 3 ) {
	if ( '' === $ym || d4u_is_expired( $ym ) ) {
		return false;
	}
	$limit = gmdate( 'Y-m', strtotime( current_time( 'Y-m' ) . '-01 +' . (int) $months . ' months' ) );
	return $ym <= $limit;
}

function d4u_expiry_label( $ym ) {
	if ( '' === $ym ) {
		return '';
	}
	$t = strtotime( $ym . '-01' );
	return $t ? date_i18n( 'M Y', $t ) : $ym;
}

/**
 * Tidy one medicine's batches: expired ones are kept aside (never counted),
 * the rest sorted so the one that expires first is picked first.
 */
function d4u_stock_entry( $batches ) {
	$good = array();
	$old  = 0;
	$qty  = 0;
	foreach ( $batches as $b ) {
		$q = max( 0, (int) $b['q'] );
		if ( d4u_is_expired( $b['e'] ) ) {
			$old += $q;
			continue;
		}
		$qty   += $q;
		$good[] = array( 'n' => substr( (string) $b['n'], 0, 30 ), 'e' => (string) $b['e'], 'q' => $q );
	}
	usort( $good, function ( $a, $b ) {
		$ea = '' === $a['e'] ? '9999-99' : $a['e'];
		$eb = '' === $b['e'] ? '9999-99' : $b['e'];
		return strcmp( $ea, $eb );
	} );
	$e = array( 'qty' => $qty, 'b' => $good );
	if ( $old ) {
		$e['x'] = $old;
	}
	return $e;
}

/** Take $qty of a medicine out of stock, earliest expiry first. Returns the batches taken. */
function d4u_stock_take( &$stock, $sku, $qty ) {
	$taken = array();
	if ( ! isset( $stock[ $sku ] ) ) {
		return $taken;
	}
	$left = (int) $qty;
	if ( ! empty( $stock[ $sku ]['b'] ) ) {
		foreach ( $stock[ $sku ]['b'] as $i => $b ) {
			if ( $left <= 0 ) {
				break;
			}
			$q = min( $left, (int) $b['q'] );
			if ( $q <= 0 ) {
				continue;
			}
			$stock[ $sku ]['b'][ $i ]['q'] -= $q;
			$taken[]                        = array( 'n' => $b['n'], 'e' => $b['e'], 'q' => $q );
			$left                          -= $q;
		}
	}
	$stock[ $sku ]['qty'] = max( 0, (int) $stock[ $sku ]['qty'] - (int) $qty );
	return $taken;
}

/* ================================================================== hold stock for an order */

/**
 * Hold the medicines for this order at its pharmacy. Called inside the routing lock,
 * so the "last strip" can only go to one order.
 */
function d4u_reserve_stock( $order, $ph ) {
	$need = d4u_order_need( $order );
	if ( ! $ph || ! $need || ! d4u_stock_fresh( $ph ) ) {
		return;
	}
	d4u_fresh_meta( $ph );
	$stock = d4u_stock( $ph );
	$held  = array();
	foreach ( $need as $sku => $qty ) {
		if ( ! isset( $stock[ $sku ] ) || $stock[ $sku ]['qty'] <= 0 ) {
			continue;
		}
		$q            = min( (int) $qty, (int) $stock[ $sku ]['qty'] );
		$held[ $sku ] = array( 'q' => $q, 'b' => d4u_stock_take( $stock, $sku, $q ) );
	}
	if ( ! $held ) {
		return;
	}
	update_user_meta( $ph, 'd4u_stock', $stock ); // not d4u_stock_save(): the upload time stays as it was
	$order->update_meta_data( '_d4u_reserved', array( 'ph' => (int) $ph, 'at' => time(), 'items' => $held ) );
}

/** Give held stock back (order cancelled, unpaid, or sent to another pharmacy). */
function d4u_release_stock( $order ) {
	$r = $order->get_meta( '_d4u_reserved' );
	if ( ! is_array( $r ) || empty( $r['ph'] ) || empty( $r['items'] ) ) {
		return;
	}
	$ph = (int) $r['ph'];
	if ( d4u_lock( 'route' ) ) {
		d4u_fresh_meta( $ph );
		$at = (int) get_user_meta( $ph, 'd4u_stock_at', true );
		if ( $at && $at <= (int) $r['at'] ) { // a newer stock file already counts what is really on the shelf
			$stock = d4u_stock( $ph );
			foreach ( $r['items'] as $sku => $h ) {
				if ( ! isset( $stock[ $sku ] ) ) {
					continue;
				}
				$stock[ $sku ]['qty'] += (int) $h['q'];
				foreach ( (array) $h['b'] as $tb ) {
					foreach ( (array) ( isset( $stock[ $sku ]['b'] ) ? $stock[ $sku ]['b'] : array() ) as $i => $b ) {
						if ( $b['n'] === $tb['n'] && $b['e'] === $tb['e'] ) {
							$stock[ $sku ]['b'][ $i ]['q'] += (int) $tb['q'];
							break;
						}
					}
				}
			}
			update_user_meta( $ph, 'd4u_stock', $stock );
		}
		d4u_unlock( 'route' );
	}
	$order->delete_meta_data( '_d4u_reserved' );
	$order->save();
}

/** What this order holds at its pharmacy: [ sku => qty ]. */
function d4u_order_held( $order ) {
	$r   = $order->get_meta( '_d4u_reserved' );
	$out = array();
	if ( is_array( $r ) && ! empty( $r['items'] ) && (int) $r['ph'] === (int) $order->get_meta( '_d4u_pharmacy' ) ) {
		foreach ( $r['items'] as $sku => $h ) {
			$out[ $sku ] = (int) $h['q'];
		}
	}
	return $out;
}

/** "Pick batch A12 (Dec 2026) × 2" — the batches held for this order, earliest expiry first. */
function d4u_pick_note( $order, $sku ) {
	$r = $order->get_meta( '_d4u_reserved' );
	if ( ! is_array( $r ) || empty( $r['items'][ $sku ]['b'] ) || (int) $r['ph'] !== (int) $order->get_meta( '_d4u_pharmacy' ) ) {
		return '';
	}
	$bits = array();
	foreach ( $r['items'][ $sku ]['b'] as $b ) {
		if ( '' === $b['n'] && '' === $b['e'] ) {
			continue; // the stock file had no batch details
		}
		$bits[] = trim( ( '' !== $b['n'] ? 'batch ' . $b['n'] : 'any batch' ) . ( '' !== $b['e'] ? ' (exp ' . d4u_expiry_label( $b['e'] ) . ')' : '' ) ) . ' × ' . (int) $b['q'];
	}
	return $bits ? 'Pick ' . implode( ', ', $bits ) : '';
}

// Cancelled, failed or refunded: the held strips go back on the shelf.
add_action( 'woocommerce_order_status_changed', function ( $id, $from, $to, $order = null ) {
	$order = $order instanceof WC_Order ? $order : wc_get_order( $id );
	if ( ! $order ) {
		return;
	}
	$order->update_meta_data( '_d4u_t_' . $to, time() ); // when each step happened, for packing and delivery times
	$order->save_meta_data();
	if ( in_array( $to, array( 'cancelled', 'failed', 'refunded' ), true ) ) {
		d4u_release_stock( $order );
	}
}, 5, 4 );

// Unpaid online orders don't hold stock forever: after 30 minutes the strips are free again.
add_action( 'd4u_release_unpaid', function () {
	$old = wc_get_orders( array(
		'type'         => 'shop_order', // not refunds
		'status'       => array( 'pending' ),
		'limit'        => 50,
		'date_created' => '<' . ( time() - 30 * MINUTE_IN_SECONDS ),
		'meta_query'   => array( array( 'key' => '_d4u_reserved', 'compare' => 'EXISTS' ) ), // phpcs:ignore
	) );
	foreach ( $old as $o ) {
		d4u_release_stock( $o );
		$o->add_order_note( 'Not paid within 30 minutes — the medicines held for it were given back to the pharmacy’s stock.' );
	}
} );
add_action( 'init', function () {
	if ( ! wp_next_scheduled( 'd4u_release_unpaid' ) ) {
		wp_schedule_event( time() + 300, 'hourly', 'd4u_release_unpaid' );
	}
} );

/* ================================================================== delivery times, zones, rain */

function d4u_target_minutes() {
	return max( 10, (int) d4u_opt( 'target_min' ) );
}

function d4u_median( $list ) {
	if ( ! $list ) {
		return 0;
	}
	sort( $list );
	$n = count( $list );
	return $n % 2 ? $list[ intdiv( $n, 2 ) ] : ( $list[ $n / 2 - 1 ] + $list[ $n / 2 ] ) / 2;
}

/**
 * Delivery facts per PIN for the last $days days, from delivered orders:
 * [ pin => [ 'n', 'total' (min, median), 'pack' (min, median), 'ride' (min, median), 'late' (share over target) ] ].
 */
function d4u_pin_stats( $days = 30 ) {
	$key   = 'd4u_pinstats_' . (int) $days;
	$cache = get_transient( $key );
	if ( is_array( $cache ) ) {
		return $cache;
	}
	$target = d4u_target_minutes();
	$rows   = array();
	$orders = wc_get_orders( array(
		'type'         => 'shop_order', // not refunds
		'status'       => array( 'completed' ),
		'limit'        => 3000,
		'date_created' => '>' . ( time() - $days * DAY_IN_SECONDS ),
	) );
	foreach ( $orders as $o ) {
		$pin  = d4u_order_pin( $o );
		$done = (int) $o->get_meta( '_d4u_delivered_at' );
		$made = $o->get_date_created() ? $o->get_date_created()->getTimestamp() : 0;
		if ( ! $pin || ! $done || ! $made || $done <= $made ) {
			continue;
		}
		$start = (int) $o->get_meta( '_d4u_t_processing' ); // after payment / prescription check
		$start = $start && $start < $done ? $start : $made;
		$ready = (int) $o->get_meta( '_d4u_t_d4u-ready' );
		$out   = (int) $o->get_meta( '_d4u_t_d4u-out' );
		$rows[ $pin ]['total'][] = ( $done - $start ) / 60;
		if ( $ready && $ready > $start ) {
			$rows[ $pin ]['pack'][] = ( $ready - $start ) / 60;
		}
		if ( $out && $done > $out ) {
			$rows[ $pin ]['ride'][] = ( $done - $out ) / 60;
		}
	}
	$stats = array();
	foreach ( $rows as $pin => $r ) {
		$late = 0;
		foreach ( $r['total'] as $m ) {
			$late += $m > $target ? 1 : 0;
		}
		$stats[ $pin ] = array(
			'n'     => count( $r['total'] ),
			'total' => round( d4u_median( $r['total'] ) ),
			'pack'  => isset( $r['pack'] ) ? round( d4u_median( $r['pack'] ) ) : null,
			'ride'  => isset( $r['ride'] ) ? round( d4u_median( $r['ride'] ) ) : null,
			'late'  => $late / count( $r['total'] ),
		);
	}
	set_transient( $key, $stats, 30 * MINUTE_IN_SECONDS );
	return $stats;
}

/** Is it raining in the city right now? Open-Meteo (free, no key), checked at most every 15 minutes. */
function d4u_raining() {
	$lat = (float) d4u_opt( 'city_lat' );
	$lng = (float) d4u_opt( 'city_lng' );
	if ( ! $lat || ! $lng || ! (int) d4u_opt( 'rain_buffer' ) ) {
		return false;
	}
	$c = get_transient( 'd4u_rain' );
	if ( false !== $c ) {
		return 'yes' === $c;
	}
	$res  = wp_remote_get( add_query_arg( array( 'latitude' => $lat, 'longitude' => $lng, 'current' => 'precipitation,weather_code' ), 'https://api.open-meteo.com/v1/forecast' ), array( 'timeout' => 3 ) );
	$rain = false;
	$life = 5 * MINUTE_IN_SECONDS; // try again soon if the weather service didn't answer
	if ( ! is_wp_error( $res ) && 200 === (int) wp_remote_retrieve_response_code( $res ) ) {
		$d    = json_decode( wp_remote_retrieve_body( $res ), true );
		$code = isset( $d['current']['weather_code'] ) ? (int) $d['current']['weather_code'] : 0;
		$mm   = isset( $d['current']['precipitation'] ) ? (float) $d['current']['precipitation'] : 0;
		$rain = $mm >= 0.3 || ( $code >= 51 && $code <= 67 ) || ( $code >= 80 && $code <= 82 ) || $code >= 95;
		$life = 15 * MINUTE_IN_SECONDS;
	}
	set_transient( 'd4u_rain', $rain ? 'yes' : 'no', $life );
	return $rain;
}

/** About how long a delivery to this PIN takes, in minutes (rain buffer included). */
function d4u_eta_minutes( $pin ) {
	$st   = d4u_pin_stats();
	$base = ( isset( $st[ $pin ] ) && $st[ $pin ]['n'] >= 5 ) ? (int) $st[ $pin ]['total'] : d4u_target_minutes();
	return $base + ( d4u_raining() ? (int) d4u_opt( 'rain_buffer' ) : 0 );
}

/** The line under the order steps: "Expected by 7:40 pm", "Arriving in about 6 min", or "Arriving soon". */
function d4u_eta_line( $order ) {
	$pin  = d4u_order_pin( $order );
	$rain = d4u_raining();
	$note = $rain ? ' It’s raining, so riders are taking a few extra minutes.' : '';
	if ( $order->has_status( 'd4u-out' ) ) {
		$st   = d4u_pin_stats();
		$ride = ( isset( $st[ $pin ]['ride'] ) && $st[ $pin ]['n'] >= 5 ) ? (int) $st[ $pin ]['ride'] : 15;
		$ride += $rain ? (int) ceil( d4u_opt( 'rain_buffer' ) / 2 ) : 0;
		$out  = (int) $order->get_meta( '_d4u_t_d4u-out' );
		$left = $out ? (int) ceil( ( $out + $ride * 60 - time() ) / 60 ) : $ride;
		// The last stretch is where GPS and countdowns go wrong (gates, lifts, landmarks), so we just say "soon".
		return ( $left > 3 ? sprintf( 'Arriving in about %d min.', $left ) : 'Arriving soon.' ) . $note;
	}
	if ( $order->has_status( array( 'processing', 'd4u-ready' ) ) ) {
		$from = (int) $order->get_meta( '_d4u_t_processing' );
		$from = $from ? $from : ( $order->get_date_created() ? $order->get_date_created()->getTimestamp() : time() );
		$by   = $from + d4u_eta_minutes( $pin ) * 60;
		if ( $by > time() + 120 ) {
			return 'Expected by ' . wp_date( get_option( 'time_format', 'g:i a' ), $by ) . '.' . $note;
		}
		return 'Almost there — your order is moving as fast as it can.' . $note;
	}
	return '';
}

/** Someone tried to order from a PIN no pharmacy covers yet: count it, so you know where to add one. */
function d4u_note_missed_pin( $pin ) {
	$pin = preg_replace( '/\D/', '', (string) $pin );
	if ( 6 !== strlen( $pin ) || ! empty( $GLOBALS['d4u_missed_noted'][ $pin ] ) ) {
		return;
	}
	$GLOBALS['d4u_missed_noted'][ $pin ] = true;
	$all = get_option( 'd4u_missed_pins', array() );
	$all = is_array( $all ) ? $all : array();
	$all[ $pin ] = array( 'n' => ( isset( $all[ $pin ]['n'] ) ? (int) $all[ $pin ]['n'] : 0 ) + 1, 'last' => time() );
	if ( count( $all ) > 500 ) {
		uasort( $all, function ( $a, $b ) {
			return $b['last'] - $a['last'];
		} );
		$all = array_slice( $all, 0, 400, true );
	}
	update_option( 'd4u_missed_pins', $all, false );
}

/* ================================================================== restock forecast */

/**
 * Units of each medicine ordered by customers in these PIN codes:
 * [ sku => [ 'w' => last 7 days, 'm' => last 28 days ] ].
 */
function d4u_area_demand( $pins ) {
	$pins = array_values( array_unique( array_filter( (array) $pins ) ) );
	sort( $pins );
	$key  = 'd4u_demand_' . md5( implode( ',', $pins ) );
	$c    = get_transient( $key );
	if ( is_array( $c ) ) {
		return $c;
	}
	$out    = array();
	$week   = time() - 7 * DAY_IN_SECONDS;
	$orders = wc_get_orders( array(
		'type'         => 'shop_order', // not refunds
		'status'       => array( 'd4u-rx', 'processing', 'd4u-ready', 'd4u-out', 'completed' ),
		'limit'        => 5000,
		'date_created' => '>' . ( time() - 28 * DAY_IN_SECONDS ),
	) );
	foreach ( $orders as $o ) {
		if ( $pins && ! in_array( d4u_order_pin( $o ), $pins, true ) ) {
			continue;
		}
		$t = $o->get_date_created() ? $o->get_date_created()->getTimestamp() : 0;
		foreach ( d4u_order_need( $o ) as $sku => $q ) {
			if ( ! isset( $out[ $sku ] ) ) {
				$out[ $sku ] = array( 'w' => 0, 'm' => 0 );
			}
			$out[ $sku ]['m'] += $q;
			$out[ $sku ]['w'] += $t >= $week ? $q : 0;
		}
	}
	set_transient( $key, $out, 30 * MINUTE_IN_SECONDS );
	return $out;
}

/**
 * Next week's likely orders, weighting the last 7 days more than the 3 weeks before
 * (so a fever wave or the rains show up quickly), with a 25% cushion.
 */
function d4u_forecast_week( $w, $m ) {
	$rate = 0.6 * ( $w / 7 ) + 0.4 * ( max( 0, $m - $w ) / 21 );
	return (int) ceil( $rate * 7 );
}

function d4u_restock_rows( $uid ) {
	$demand = d4u_area_demand( d4u_pins( $uid ) );
	$stock  = d4u_stock( $uid );
	$fresh  = d4u_stock_fresh( $uid );
	$prods  = d4u_sellable_products();
	$rows   = array();
	foreach ( $demand as $sku => $d ) {
		if ( ! isset( $prods[ $sku ] ) ) {
			continue;
		}
		$f      = d4u_forecast_week( $d['w'], $d['m'] );
		$have   = ( $fresh && isset( $stock[ $sku ] ) ) ? (int) $stock[ $sku ]['qty'] : null;
		$need   = null === $have ? null : max( 0, (int) ceil( $f * 1.25 ) - $have );
		$rows[] = array(
			'sku'  => $sku,
			'name' => $prods[ $sku ]->get_name(),
			'pack' => (string) get_post_meta( $prods[ $sku ]->get_id(), '_d4u_pack', true ),
			'w'    => $d['w'],
			'm'    => $d['m'],
			'f'    => $f,
			'have' => $have,
			'buy'  => $need,
		);
	}
	usort( $rows, function ( $a, $b ) {
		$x = (int) $b['buy'] - (int) $a['buy'];
		return $x ? $x : $b['f'] - $a['f'];
	} );
	return $rows;
}

/** Batches that expire within 3 months, and expired stock still on the shelf. */
function d4u_expiry_rows( $uid ) {
	$prods = d4u_sellable_products();
	$soon  = array();
	$gone  = array();
	foreach ( d4u_stock( $uid ) as $sku => $s ) {
		$name = isset( $prods[ $sku ] ) ? $prods[ $sku ]->get_name() : $sku;
		foreach ( isset( $s['b'] ) ? $s['b'] : array() as $b ) {
			if ( $b['q'] > 0 && d4u_expiry_soon( $b['e'] ) ) {
				$soon[] = array( $name, $b['n'], $b['e'], $b['q'] );
			}
		}
		if ( ! empty( $s['x'] ) ) {
			$gone[] = array( $name, (int) $s['x'] );
		}
	}
	usort( $soon, function ( $a, $b ) {
		return strcmp( $a[2], $b[2] );
	} );
	return array( $soon, $gone );
}

/** The "Restock" screen in the pharmacy dashboard. */
function d4u_ph_view_restock( $uid, $boss ) {
	$out = d4u_ph_view_head( 'Restock', 'What customers near your shop will likely order next week, from the last 4 weeks of dawa4u orders in your PIN codes — so the right medicines are on your shelf before people ask.' );
	if ( $boss ) {
		return $out . d4u_ph_empty( 'pill', 'Each pharmacy sees its own forecast', 'It uses the orders in that pharmacy’s PIN codes and its own stock.' );
	}
	if ( ! d4u_pins( $uid ) ) {
		return $out . d4u_ph_empty( 'pill', 'Add your PIN codes first', 'The forecast uses orders from the PIN codes you deliver to. Add them in Shop details.' );
	}
	$fresh = d4u_stock_fresh( $uid );
	if ( ! $fresh ) {
		$out .= '<p class="d4u-flash d4u-flash--warn">Upload today’s stock in <a href="' . esc_url( d4u_ph_url( 'connect' ) ) . '">Billing software</a> to see how many to order. Until then you see the likely demand only.</p>';
	}
	$rows = d4u_restock_rows( $uid );
	if ( ! $rows ) {
		$out .= d4u_ph_empty( 'pill', 'Not enough orders yet', 'After a few days of orders in your PIN codes, the forecast appears here.' );
	} else {
		$out .= '<div class="d4p-tablewrap"><table class="d4p-table"><thead><tr><th>Medicine</th><th class="num">Last 7 days</th><th class="num">Last 4 weeks</th><th class="num">Likely next week</th><th class="num">Your stock</th><th class="num">Order</th></tr></thead><tbody>';
		foreach ( array_slice( $rows, 0, 80 ) as $r ) {
			$out .= '<tr><td><strong>' . esc_html( $r['name'] ) . '</strong>' . ( $r['pack'] ? '<br><span class="d4u-small">' . esc_html( $r['pack'] ) . '</span>' : '' ) . '</td>';
			$out .= '<td class="num">' . (int) $r['w'] . '</td><td class="num">' . (int) $r['m'] . '</td><td class="num">' . (int) $r['f'] . '</td>';
			$out .= '<td class="num">' . ( null === $r['have'] ? '<span class="d4p-mute">—</span>' : (int) $r['have'] ) . '</td>';
			$out .= '<td class="num">' . ( null === $r['buy'] ? '<span class="d4p-mute">—</span>' : ( $r['buy'] ? '<span class="d4u-stock is-low">' . (int) $r['buy'] . '</span>' : '<span class="d4u-stock">enough</span>' ) ) . '</td></tr>';
		}
		$out .= '</tbody></table></div>';
		$out .= '<p class="d4u-small"><a href="' . esc_url( d4u_export_url( 'restock' ) ) . '">Download this list (CSV)</a> to send to your distributor. “Order” keeps a 25% cushion over next week’s likely orders.</p>';
	}

	list( $soon, $gone ) = d4u_expiry_rows( $uid );
	$out .= '<h2 class="d4p-h">Expiry</h2>';
	if ( $gone ) {
		$out .= '<div class="d4u-flash d4u-flash--error"><strong>Expired stock in your last upload</strong> — it is not counted and never sent to customers. Take it off the shelf: ' . esc_html( implode( ' · ', array_map( function ( $g ) {
			return $g[0] . ' (' . $g[1] . ')';
		}, array_slice( $gone, 0, 40 ) ) ) ) . '</div>';
	}
	if ( $soon ) {
		$out .= '<div class="d4p-tablewrap"><table class="d4p-table"><thead><tr><th>Expiring within 3 months</th><th>Batch</th><th>Expiry</th><th class="num">Qty</th></tr></thead><tbody>';
		foreach ( array_slice( $soon, 0, 80 ) as $s ) {
			$out .= '<tr><td>' . esc_html( $s[0] ) . '</td><td>' . esc_html( $s[1] ) . '</td><td>' . esc_html( d4u_expiry_label( $s[2] ) ) . '</td><td class="num">' . (int) $s[3] . '</td></tr>';
		}
		$out .= '</tbody></table></div><p class="d4u-small">dawa4u packs these first (first expired, first out) — the packing card tells you which batch to pick.</p>';
	} elseif ( ! $gone ) {
		$out .= '<p class="d4u-small d4p-mute">' . ( $fresh ? 'Nothing in your stock expires in the next 3 months.' : 'Upload a stock file with Batch and Expiry columns (Marg’s stock report has them) to see what expires soon.' ) . '</p>';
	}
	return $out;
}

add_action( 'template_redirect', function () {
	if ( empty( $_GET['d4u_export'] ) || 'restock' !== $_GET['d4u_export'] ) { // phpcs:ignore
		return;
	}
	$uid = get_current_user_id();
	if ( ! $uid || ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ), 'd4u_export' ) || ! d4u_is_pharmacy( $uid ) || 'approved' !== d4u_status( $uid ) ) {
		wp_die( 'This download link has expired. Open the dashboard and try again.', 'dawa4u', array( 'response' => 403 ) );
	}
	$rows = array( array( 'Item code', 'Medicine', 'Pack', 'Ordered last 7 days', 'Ordered last 4 weeks', 'Likely next week', 'Your stock', 'Order' ) );
	foreach ( d4u_restock_rows( $uid ) as $r ) {
		$rows[] = array( $r['sku'], d4u_csv_cell( $r['name'] ), d4u_csv_cell( $r['pack'] ), $r['w'], $r['m'], $r['f'], null === $r['have'] ? '' : $r['have'], null === $r['buy'] ? '' : $r['buy'] );
	}
	d4u_csv_out( 'dawa4u-restock-' . current_time( 'Y-m-d' ) . '.csv', $rows );
}, 5 );

/* ================================================================== packing clock */

/** Minutes an order has been waiting to be packed (0 if not waiting). */
function d4u_pack_wait( $o ) {
	if ( ! $o->has_status( 'processing' ) ) {
		return 0;
	}
	$t = (int) $o->get_meta( '_d4u_t_processing' );
	$t = $t ? $t : ( $o->get_date_created() ? $o->get_date_created()->getTimestamp() : time() );
	return (int) floor( ( time() - $t ) / 60 );
}

/** Average minutes from "to pack" to "packed" for a pharmacy since $since. null = no orders packed. */
function d4u_avg_pack_minutes( $uid, $since ) {
	$mins = array();
	foreach ( d4u_ph_query( $uid, array( 'd4u-ready', 'd4u-out', 'completed' ), array( 'date_modified' => '>' . $since, 'limit' => 200 ) ) as $o ) {
		$a = (int) $o->get_meta( '_d4u_t_processing' );
		$b = (int) $o->get_meta( '_d4u_t_d4u-ready' );
		if ( $a && $b && $b >= $since && $b > $a ) {
			$mins[] = ( $b - $a ) / 60;
		}
	}
	return $mins ? (int) round( array_sum( $mins ) / count( $mins ) ) : null;
}

/* ================================================================== in demand this week (medicine list) */

function d4u_trending_ids( $limit = 8 ) {
	$c = get_transient( 'd4u_trending' );
	if ( ! is_array( $c ) ) {
		$c = array();
		foreach ( d4u_area_demand( array() ) as $sku => $d ) {
			if ( $d['w'] > 0 ) {
				$c[ $sku ] = $d['w'];
			}
		}
		arsort( $c );
		set_transient( 'd4u_trending', $c, HOUR_IN_SECONDS );
	}
	$ids = array();
	foreach ( array_keys( $c ) as $sku ) {
		$id = wc_get_product_id_by_sku( $sku );
		$p  = $id ? wc_get_product( $id ) : null;
		if ( $p && 'publish' === $p->get_status() && $p->is_in_stock() ) {
			$ids[] = $id;
		}
		if ( count( $ids ) >= $limit ) {
			break;
		}
	}
	return $ids;
}

add_action( 'woocommerce_before_shop_loop', function () {
	if ( ! is_shop() || is_search() || is_paged() || ! empty( $_GET['orderby'] ) ) { // phpcs:ignore
		return;
	}
	$ids = d4u_trending_ids();
	if ( count( $ids ) < 3 ) {
		return; // not enough orders yet to say what is popular
	}
	echo '<section class="d4u-shelf" aria-label="Ordered most this week"><h2>Ordered most this week</h2><ul>';
	foreach ( $ids as $id ) {
		$p = wc_get_product( $id );
		echo '<li><a class="d4u-shelf__link" href="' . esc_url( $p->get_permalink() ) . '">' . wp_kses_post( $p->get_image( 'woocommerce_thumbnail' ) ) . '<span class="d4u-shelf__name">' . esc_html( $p->get_name() ) . ( d4u_needs_rx( $p ) ? ' <span class="d4u-rx-tag">Rx</span>' : '' ) . '</span><span class="d4u-shelf__price">' . wp_kses_post( $p->get_price_html() ) . '</span></a>';
		echo '<a class="button add_to_cart_button ajax_add_to_cart d4u-shelf__add" href="' . esc_url( $p->add_to_cart_url() ) . '" data-product_id="' . esc_attr( $id ) . '" data-quantity="1" rel="nofollow" aria-label="' . esc_attr( 'Add ' . $p->get_name() . ' to cart' ) . '">Add</a></li>';
	}
	echo '</ul></section>';
}, 15 );

/* ================================================================== zones (wp-admin) */

add_action( 'admin_menu', function () {
	add_submenu_page( 'woocommerce', 'dawa4u zones', 'dawa4u zones', 'manage_woocommerce', 'd4u-zones', 'd4u_zones_page' );
}, 60 );

function d4u_zones_page() {
	$target = d4u_target_minutes();
	$stats  = d4u_pin_stats();
	$missed = get_option( 'd4u_missed_pins', array() );
	$missed = is_array( $missed ) ? $missed : array();
	$cover  = array();
	foreach ( d4u_partners( 'd4u_pharmacy' ) as $u ) {
		foreach ( d4u_pins( $u->ID ) as $pin ) {
			$cover[ $pin ][] = $u->ID;
		}
	}
	$pins = array_unique( array_merge( array_keys( $cover ), array_keys( $stats ), array_keys( $missed ) ) );
	sort( $pins );

	echo '<div class="wrap"><h1>dawa4u zones</h1>';
	echo '<p>Each PIN code is a delivery zone. The quick-commerce rule: when a zone gets too slow, don’t just add riders — add a pharmacy there so the trip gets shorter. Your target is <strong>' . (int) $target . ' minutes</strong> from “paid / prescription approved” to “delivered” (change it under WooCommerce → dawa4u partners → Charges). Last 30 days. ' . ( d4u_raining() ? '<strong>It is raining now</strong> — customers see a longer delivery time.' : '' ) . '</p>';
	if ( ! $pins ) {
		echo '<p>No zones yet — approve a pharmacy and add its PIN codes.</p></div>';
		return;
	}
	echo '<table class="widefat striped"><thead><tr><th>PIN</th><th>Pharmacies</th><th>Delivered</th><th>Usual delivery time</th><th>Packing</th><th>Ride</th><th>Late</th><th>People who couldn’t order</th><th>What to do</th></tr></thead><tbody>';
	foreach ( $pins as $pin ) {
		$s    = isset( $stats[ $pin ] ) ? $stats[ $pin ] : null;
		$c    = isset( $cover[ $pin ] ) ? $cover[ $pin ] : array();
		$open = 0;
		foreach ( $c as $id ) {
			$open += 'yes' === get_user_meta( $id, 'd4u_open', true ) ? 1 : 0;
		}
		$miss = isset( $missed[ $pin ] ) ? (int) $missed[ $pin ]['n'] : 0;
		$todo = '';
		if ( ! $c ) {
			$todo = $miss ? '<strong style="color:#b42318">Find a pharmacy here</strong>' : 'No pharmacy';
		} elseif ( $s && $s['n'] >= 5 && ( $s['total'] > $target || $s['late'] > 0.3 ) ) {
			$todo = '<strong style="color:#b45309">Too slow — add a pharmacy nearer the customers (split this zone)</strong>';
		} elseif ( 1 === count( $c ) && $s && $s['n'] >= 50 ) {
			$todo = 'Busy with one pharmacy — add a backup';
		} elseif ( $s && $s['n'] >= 5 ) {
			$todo = '<span style="color:#15803d">On time</span>';
		} else {
			$todo = 'Not enough deliveries yet';
		}
		echo '<tr><td><strong>' . esc_html( $pin ) . '</strong></td>';
		echo '<td>' . ( $c ? esc_html( implode( ', ', array_map( 'd4u_partner_name', $c ) ) ) . ' <span class="description">(' . (int) $open . ' open)</span>' : '—' ) . '</td>';
		echo '<td>' . ( $s ? (int) $s['n'] : 0 ) . '</td>';
		echo '<td>' . ( $s ? (int) $s['total'] . ' min' : '—' ) . '</td>';
		echo '<td>' . ( $s && null !== $s['pack'] ? (int) $s['pack'] . ' min' : '—' ) . '</td>';
		echo '<td>' . ( $s && null !== $s['ride'] ? (int) $s['ride'] . ' min' : '—' ) . '</td>';
		echo '<td>' . ( $s ? (int) round( $s['late'] * 100 ) . '%' : '—' ) . '</td>';
		echo '<td>' . ( $miss ? (int) $miss . ' <span class="description">(last ' . esc_html( human_time_diff( $missed[ $pin ]['last'] ) ) . ' ago)</span>' : '—' ) . '</td>';
		echo '<td>' . wp_kses_post( $todo ) . '</td></tr>';
	}
	echo '</tbody></table><p class="description">Usual = the middle value of all deliveries (one very late order doesn’t skew it). “People who couldn’t order” counts checkout and “Check near you” attempts from PIN codes no pharmacy covers.</p></div>';
}
