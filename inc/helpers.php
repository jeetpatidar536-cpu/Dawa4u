<?php
/**
 * Small shared helpers: settings, dawaPass, prescriptions, partners, PIN codes, mail.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Settings (WooCommerce → dawa4u). */
function d4u_opt( $key ) {
	$defaults = array(
		'delivery_fee' => 25,   // ₹ per order, free with dawaPass
		'handling_fee' => 5,    // ₹ per order
		'pass_off'     => 15,   // % off medicines for dawaPass members
		'pass_days'    => 30,   // how long one dawaPass lasts
		'rider_pay'    => 30,   // ₹ paid to the rider per delivery
		'pin_check'    => 'auto', // auto = only once at least one pharmacy is approved
		'target_min'   => 30,     // delivery promise per zone, minutes from paid/approved to delivered
		'pack_min'     => 5,      // an order waiting longer than this to be packed turns red
		'rain_buffer'  => 10,     // minutes added to delivery times while it rains (0 = don't check the weather)
		'city_lat'     => 22.7196, // Indore — where to check the weather
		'city_lng'     => 75.8577,
	);
	$o = get_option( 'd4u_settings', array() );
	if ( is_array( $o ) && isset( $o[ $key ] ) && '' !== $o[ $key ] ) {
		return $o[ $key ];
	}
	return isset( $defaults[ $key ] ) ? $defaults[ $key ] : null;
}

/** Medicine groups: key in the old apps => [ category slug, name ]. */
function d4u_cats() {
	return array(
		'fever' => array( 'fever-pain', 'Fever & pain' ),
		'bp'    => array( 'diabetes-bp', 'Diabetes & BP' ),
		'vit'   => array( 'vitamins', 'Vitamins' ),
		'baby'  => array( 'baby-care', 'Baby care' ),
		'skin'  => array( 'skin-care', 'Skin care' ),
		'kit'   => array( 'first-aid', 'First aid' ),
		'ors'   => array( 'stomach-care', 'Stomach care' ),
		'dev'   => array( 'health-devices', 'Health devices' ),
	);
}

/* ---------------------------------------------------------------- products */

function d4u_pass_product_id() {
	return (int) get_option( 'd4u_pass_product' );
}

function d4u_is_pass_product( $product_id ) {
	$pass = d4u_pass_product_id();
	return $pass && (int) $product_id === $pass;
}

/** Does this product need a prescription? */
function d4u_needs_rx( $product ) {
	if ( is_numeric( $product ) ) {
		$product = wc_get_product( $product );
	}
	if ( ! $product ) {
		return false;
	}
	$id = $product->get_parent_id() ? $product->get_parent_id() : $product->get_id();
	return 'yes' === get_post_meta( $id, '_d4u_rx', true );
}

/* ---------------------------------------------------------------- dawaPass */

function d4u_pass_until( $uid ) {
	return (int) get_user_meta( (int) $uid, 'd4u_pass_until', true );
}

function d4u_has_pass( $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	return $uid && d4u_pass_until( $uid ) > time();
}

function d4u_cart_has_pass() {
	if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
		return false;
	}
	foreach ( WC()->cart->get_cart() as $item ) {
		if ( d4u_is_pass_product( $item['product_id'] ) ) {
			return true;
		}
	}
	return false;
}

/** Prescription medicines in the cart: [ name, ... ]. */
function d4u_cart_rx_names() {
	$names = array();
	if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
		return $names;
	}
	foreach ( WC()->cart->get_cart() as $item ) {
		if ( ! empty( $item['data'] ) && d4u_needs_rx( $item['data'] ) ) {
			$names[] = $item['data']->get_name();
		}
	}
	return array_values( array_unique( $names ) );
}

/** Add 30 days of dawaPass (on top of any days left). */
function d4u_grant_pass( $uid, $days = 0 ) {
	$uid  = (int) $uid;
	$days = $days ? (int) $days : (int) d4u_opt( 'pass_days' );
	if ( ! $uid ) {
		return 0;
	}
	$from  = max( time(), d4u_pass_until( $uid ) );
	$until = $from + $days * DAY_IN_SECONDS;
	update_user_meta( $uid, 'd4u_pass_until', $until );
	return $until;
}

/* ---------------------------------------------------------------- PIN codes & partners */

function d4u_parse_pins( $text ) {
	preg_match_all( '/(?<!\d)\d{6}(?!\d)/', (string) $text, $m );
	return array_values( array_unique( $m[0] ) );
}

function d4u_pins( $uid ) {
	$p = get_user_meta( (int) $uid, 'd4u_pins', true );
	return is_array( $p ) ? $p : array();
}

function d4u_status( $uid ) {
	$s = get_user_meta( (int) $uid, 'd4u_status', true );
	return $s ? $s : 'unverified';
}

function d4u_has_role( $uid, $role ) {
	$u = get_userdata( (int) $uid );
	return $u && in_array( $role, (array) $u->roles, true );
}

function d4u_is_pharmacy( $uid = 0 ) {
	return d4u_has_role( $uid ? $uid : get_current_user_id(), 'd4u_pharmacy' );
}

function d4u_is_rider( $uid = 0 ) {
	return d4u_has_role( $uid ? $uid : get_current_user_id(), 'd4u_rider' );
}

function d4u_is_boss( $uid = 0 ) {
	$uid = $uid ? $uid : get_current_user_id();
	return $uid && user_can( $uid, 'manage_woocommerce' );
}

/** Approved partners of one kind. */
function d4u_partners( $role, $status = 'approved' ) {
	$args = array(
		'role'    => $role,
		'number'  => 500,
		'orderby' => 'registered',
		'order'   => 'ASC',
	);
	if ( $status ) {
		$args['meta_query'] = array( array( 'key' => 'd4u_status', 'value' => $status ) ); // phpcs:ignore
	}
	return get_users( $args );
}

/** Approved pharmacies that deliver to a PIN. */
function d4u_pharmacies_for_pin( $pin ) {
	$pin = preg_replace( '/\D/', '', (string) $pin );
	if ( 6 !== strlen( $pin ) ) {
		return array();
	}
	$out = array();
	foreach ( d4u_partners( 'd4u_pharmacy' ) as $u ) {
		if ( in_array( $pin, d4u_pins( $u->ID ), true ) ) {
			$out[] = (int) $u->ID;
		}
	}
	return $out;
}

/** Stock counts only while it is fresh: a file uploaded a week ago says little about today. */
function d4u_stock_fresh( $uid ) {
	$at = (int) get_user_meta( $uid, 'd4u_stock_at', true );
	return $at && ( time() - $at ) <= D4U_STOCK_DAYS * DAY_IN_SECONDS;
}

/**
 * Does a pharmacy have these medicines? $need = [ sku => qty ].
 * full = everything in stock · partial = some · none = nothing · unknown = no recent stock from this pharmacy.
 */
function d4u_stock_match( $uid, $need ) {
	if ( ! $need ) {
		return 'unknown';
	}
	if ( ! function_exists( 'd4u_stock' ) || ! d4u_stock_fresh( $uid ) ) {
		return 'unknown';
	}
	$stock = d4u_stock( $uid );
	$have  = 0;
	foreach ( $need as $sku => $qty ) {
		if ( isset( $stock[ $sku ] ) && (int) $stock[ $sku ]['qty'] >= max( 1, (int) $qty ) ) {
			$have++;
		}
	}
	return $have === count( $need ) ? 'full' : ( $have ? 'partial' : 'none' );
}

/** Medicines an order needs: [ sku => qty ] (no dawaPass). */
function d4u_order_need( $order ) {
	$need = array();
	foreach ( $order->get_items() as $item ) {
		$p = $item->get_product();
		if ( ! $p || ! $p->get_sku() || d4u_is_pass_product( $item->get_product_id() ) ) {
			continue;
		}
		$need[ $p->get_sku() ] = ( isset( $need[ $p->get_sku() ] ) ? $need[ $p->get_sku() ] : 0 ) + (int) $item->get_quantity();
	}
	return $need;
}

/**
 * Every pharmacy that delivers to the PIN, best first:
 * open and has everything in stock → open, stock not shared → open, has some → closed but has everything → the rest.
 * Same rank: the one with fewer orders waiting goes first. $skip = pharmacies that already said no.
 *
 * @return array [ [ 'id' => uid, 'open' => bool, 'stock' => full|partial|none|unknown ], ... ]
 */
function d4u_rank_pharmacies( $pin, $need = array(), $skip = array() ) {
	$skip  = array_map( 'intval', (array) $skip );
	$score = array( 'full' => 3, 'unknown' => 2, 'partial' => 1, 'none' => 0 );
	$list  = array();
	foreach ( d4u_pharmacies_for_pin( $pin ) as $uid ) {
		if ( in_array( $uid, $skip, true ) ) {
			continue;
		}
		$open   = 'yes' === get_user_meta( $uid, 'd4u_open', true );
		$stock  = d4u_stock_match( $uid, $need );
		$load   = function_exists( 'd4u_ph_query' ) ? count( d4u_ph_query( $uid, array( 'd4u-rx', 'processing', 'd4u-request' ), array( 'return' => 'ids' ) ) ) : 0;
		$list[] = array(
			'id'    => $uid,
			'open'  => $open,
			'stock' => $stock,
			'rank'  => ( $open ? 25 : 0 ) + 10 * $score[ $stock ],
			'load'  => $load,
		);
	}
	usort( $list, function ( $a, $b ) {
		if ( $a['rank'] !== $b['rank'] ) {
			return $b['rank'] - $a['rank'];
		}
		return $a['load'] - $b['load'];
	} );
	return $list;
}

/** The best pharmacy for a PIN (and these medicines). 0 = none. */
function d4u_find_pharmacy( $pin, $need = array(), $skip = array() ) {
	$list = d4u_rank_pharmacies( $pin, $need, $skip );
	return $list ? (int) $list[0]['id'] : 0;
}

function d4u_stock_words( $stock ) {
	$w = array(
		'full'    => 'has everything in stock',
		'partial' => 'has some of the medicines in stock',
		'none'    => 'has none of the medicines in stock',
		'unknown' => 'has not shared stock',
	);
	return isset( $w[ $stock ] ) ? $w[ $stock ] : '';
}

/** Should checkout refuse PINs no pharmacy covers? */
function d4u_pin_check_on() {
	$mode = d4u_opt( 'pin_check' );
	if ( 'yes' === $mode ) {
		return true;
	}
	if ( 'no' === $mode ) {
		return false;
	}
	return count( d4u_partners( 'd4u_pharmacy' ) ) > 0;
}

function d4u_partner_name( $uid ) {
	$uid = (int) $uid;
	if ( ! $uid ) {
		return '';
	}
	$shop = get_user_meta( $uid, 'd4u_shop', true );
	if ( $shop ) {
		return $shop;
	}
	$u = get_userdata( $uid );
	return $u ? $u->display_name : '';
}

/* ---------------------------------------------------------------- orders */

function d4u_order_pin( $order ) {
	$pin = $order->get_shipping_postcode();
	if ( ! $pin ) {
		$pin = $order->get_billing_postcode();
	}
	return preg_replace( '/\D/', '', (string) $pin );
}

function d4u_order_has_rx_items( $order ) {
	foreach ( $order->get_items() as $item ) {
		$p = $item->get_product();
		if ( $p && d4u_needs_rx( $p ) ) {
			return true;
		}
	}
	return false;
}

/** Still waiting for a pharmacist to approve the prescription? */
function d4u_rx_pending( $order ) {
	if ( ! d4u_order_has_rx_items( $order ) ) {
		return false;
	}
	return 'approved' !== $order->get_meta( '_d4u_rx_state' );
}

function d4u_order_only_pass( $order ) {
	$items = $order->get_items();
	if ( ! $items ) {
		return false;
	}
	foreach ( $items as $item ) {
		if ( ! d4u_is_pass_product( $item->get_product_id() ) ) {
			return false;
		}
	}
	return true;
}

function d4u_new_code() {
	return str_pad( (string) wp_rand( 0, 9999 ), 4, '0', STR_PAD_LEFT );
}

/** Give an order its delivery code and pharmacy (by PIN), once. */
function d4u_prepare_order( $order ) {
	if ( ! $order->get_meta( '_d4u_code' ) ) {
		$order->update_meta_data( '_d4u_code', d4u_new_code() );
	}
	if ( ! $order->get_meta( '_d4u_pharmacy' ) && ! d4u_order_only_pass( $order ) ) {
		$need   = d4u_order_need( $order );
		$locked = function_exists( 'd4u_lock' ) && $need ? d4u_lock( 'route' ) : false; // one checkout at a time decides who gets the last strip
		if ( $locked ) {
			d4u_fresh_meta( d4u_pharmacies_for_pin( d4u_order_pin( $order ) ) );
		}
		$list   = d4u_rank_pharmacies( d4u_order_pin( $order ), $need );
		if ( $list ) {
			$ph = (int) $list[0]['id'];
			$order->update_meta_data( '_d4u_pharmacy', $ph );
			if ( function_exists( 'd4u_reserve_stock' ) ) {
				d4u_reserve_stock( $order, $ph );
			}
			$order->add_order_note( sprintf( 'Checked %d pharmac%s for PIN %s. Sent to %s%s.', count( $list ), 1 === count( $list ) ? 'y' : 'ies', d4u_order_pin( $order ), d4u_partner_name( $ph ), $need ? ' — ' . d4u_stock_words( $list[0]['stock'] ) : '' ) );
			if ( $locked ) {
				d4u_unlock( 'route' );
			}
		} else {
			if ( $locked ) {
				d4u_unlock( 'route' );
			}
			$order->add_order_note( 'No partner pharmacy covers PIN ' . d4u_order_pin( $order ) . ' yet — choose one in the dawa4u box on this order.' );
		}
	}
}

/** Delivery, handling and the dawaPass saving on an order the pharmacist filled in. */
function d4u_order_add_charges( $order ) {
	$uid  = $order->get_customer_id();
	$pass = d4u_has_pass( $uid );
	$sub  = 0;
	foreach ( $order->get_items() as $item ) {
		if ( ! d4u_is_pass_product( $item->get_product_id() ) ) {
			$sub += (float) $item->get_subtotal();
		}
	}
	foreach ( $order->get_items( array( 'shipping', 'fee' ) ) as $id => $item ) {
		$order->remove_item( $id );
	}

	$ship = new WC_Order_Item_Shipping();
	$ship->set_method_title( $pass ? 'Free with dawaPass' : 'Home delivery' );
	$ship->set_method_id( 'flat_rate' );
	$ship->set_total( $pass ? 0 : (float) d4u_opt( 'delivery_fee' ) );
	$order->add_item( $ship );

	$hand = (float) d4u_opt( 'handling_fee' );
	if ( $hand > 0 ) {
		$fee = new WC_Order_Item_Fee();
		$fee->set_name( 'Handling' );
		$fee->set_amount( $hand );
		$fee->set_total( $hand );
		$fee->set_tax_status( 'none' );
		$order->add_item( $fee );
	}
	if ( $pass && $sub > 0 ) {
		$off = round( $sub * (float) d4u_opt( 'pass_off' ) / 100 );
		if ( $off > 0 ) {
			$fee = new WC_Order_Item_Fee();
			$fee->set_name( sprintf( 'dawaPass savings (%s%%)', d4u_opt( 'pass_off' ) ) );
			$fee->set_amount( -$off );
			$fee->set_total( -$off );
			$fee->set_tax_status( 'none' );
			$order->add_item( $fee );
		}
	}
	$order->calculate_totals( false );
}

/* ---------------------------------------------------------------- prescription files */

function d4u_rx_dir() {
	$up   = wp_upload_dir( null, false );
	$base = trailingslashit( $up['basedir'] ) . 'dawa4u-rx';
	if ( ! is_dir( $base ) ) {
		wp_mkdir_p( $base );
	}
	if ( ! file_exists( $base . '/.htaccess' ) ) {
		@file_put_contents( $base . '/.htaccess', "Require all denied\nDeny from all\n" ); // phpcs:ignore
	}
	if ( ! file_exists( $base . '/index.php' ) ) {
		@file_put_contents( $base . '/index.php', "<?php\n// Silence.\n" ); // phpcs:ignore
	}
	return $base;
}

/**
 * Store one uploaded prescription file ($_FILES-style array). Returns [ path (relative), name, type ] or WP_Error.
 */
function d4u_store_rx_file( $f ) {
	if ( empty( $f['tmp_name'] ) || ! empty( $f['error'] ) || ! is_uploaded_file( $f['tmp_name'] ) ) {
		return new WP_Error( 'd4u_rx', 'The file did not upload. Please try again.' );
	}
	if ( (int) $f['size'] > 10 * MB_IN_BYTES ) {
		return new WP_Error( 'd4u_rx', 'That file is too big. Please send a photo or PDF under 10 MB.' );
	}
	$types = array(
		'jpg|jpeg|jpe' => 'image/jpeg',
		'png'          => 'image/png',
		'webp'         => 'image/webp',
		'heic'         => 'image/heic',
		'pdf'          => 'application/pdf',
	);
	$check = wp_check_filetype_and_ext( $f['tmp_name'], $f['name'], $types );
	if ( empty( $check['ext'] ) || empty( $check['type'] ) ) {
		return new WP_Error( 'd4u_rx', 'Please send a photo (JPG, PNG, WEBP, HEIC) or a PDF.' );
	}
	$sub = gmdate( 'Y-m' );
	$dir = d4u_rx_dir() . '/' . $sub;
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}
	$file = bin2hex( random_bytes( 16 ) ) . '.' . $check['ext'];
	if ( ! @move_uploaded_file( $f['tmp_name'], $dir . '/' . $file ) ) { // phpcs:ignore
		return new WP_Error( 'd4u_rx', 'Could not save the file. Please try again.' );
	}
	return array(
		'path' => $sub . '/' . $file,
		'name' => sanitize_file_name( $f['name'] ),
		'type' => $check['type'],
	);
}

/** Link that shows prescription file $i of an order (only to the customer, its pharmacy and the dawa4u team). */
function d4u_rx_file_url( $order, $i ) {
	return add_query_arg( array(
		'd4u_rx_file' => $order->get_id(),
		'i'           => (int) $i,
		'_wpnonce'    => wp_create_nonce( 'd4u_rxf_' . $order->get_id() ),
	), home_url( '/' ) );
}

function d4u_can_see_order( $order, $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	if ( ! $uid || ! $order ) {
		return false;
	}
	if ( d4u_is_boss( $uid ) ) {
		return true;
	}
	if ( (int) $order->get_customer_id() === $uid ) {
		return true;
	}
	if ( 'approved' === d4u_status( $uid ) && (int) $order->get_meta( '_d4u_pharmacy' ) === $uid ) {
		return true;
	}
	return false;
}

add_action( 'init', function () {
	if ( empty( $_GET['d4u_rx_file'] ) ) { // phpcs:ignore
		return;
	}
	$oid = absint( $_GET['d4u_rx_file'] ); // phpcs:ignore
	$i   = isset( $_GET['i'] ) ? absint( $_GET['i'] ) : 0; // phpcs:ignore
	if ( ! is_user_logged_in() || ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ), 'd4u_rxf_' . $oid ) ) {
		wp_die( 'Please log in to see this prescription.', 'dawa4u', array( 'response' => 403 ) );
	}
	$order = function_exists( 'wc_get_order' ) ? wc_get_order( $oid ) : null;
	if ( ! $order || ! d4u_can_see_order( $order ) ) {
		wp_die( 'You can\'t see this prescription.', 'dawa4u', array( 'response' => 403 ) );
	}
	$files = (array) $order->get_meta( '_d4u_rx_files' );
	if ( empty( $files[ $i ]['path'] ) ) {
		wp_die( 'File not found.', 'dawa4u', array( 'response' => 404 ) );
	}
	$path = d4u_rx_dir() . '/' . $files[ $i ]['path'];
	if ( false !== strpos( $files[ $i ]['path'], '..' ) || ! is_file( $path ) ) {
		wp_die( 'File not found.', 'dawa4u', array( 'response' => 404 ) );
	}
	nocache_headers();
	header( 'Content-Type: ' . $files[ $i ]['type'] );
	header( 'Content-Length: ' . filesize( $path ) );
	header( 'Content-Disposition: inline; filename="' . rawurlencode( $files[ $i ]['name'] ) . '"' );
	header( 'X-Content-Type-Options: nosniff' );
	readfile( $path ); // phpcs:ignore
	exit;
}, 20 );

/* ---------------------------------------------------------------- mail & pages */

/** Send a short branded email (uses the WooCommerce email look). */
function d4u_mail( $to, $subject, $heading, $html ) {
	if ( ! $to ) {
		return;
	}
	if ( function_exists( 'WC' ) ) {
		$m = WC()->mailer();
		$m->send( $to, $subject, $m->wrap_message( $heading, $html ) );
		return;
	}
	wp_mail( $to, $subject, wp_strip_all_tags( $html ) );
}

function d4u_user_email( $uid ) {
	$u = get_userdata( (int) $uid );
	return $u ? $u->user_email : '';
}

function d4u_page_url( $key ) {
	$id = (int) get_option( 'd4u_page_' . $key );
	if ( $id && 'publish' === get_post_status( $id ) ) {
		return get_permalink( $id );
	}
	$slugs = array(
		'pharmacy' => 'pharmacy-dashboard',
		'rider'    => 'rider-dashboard',
		'rx'       => 'upload-prescription',
	);
	return home_url( '/' . ( isset( $slugs[ $key ] ) ? $slugs[ $key ] : '' ) . '/' );
}

function d4u_inr( $n ) {
	return '₹' . number_format_i18n( (float) $n, 0 );
}

/** Flash messages carried across a redirect. */
function d4u_flash_set( $text, $type = 'error' ) {
	$key = wp_generate_password( 10, false );
	set_transient( 'd4u_flash_' . $key, array( $text, $type ), 120 );
	return $key;
}

function d4u_flash_html() {
	if ( empty( $_GET['d4u_flash'] ) ) { // phpcs:ignore
		return '';
	}
	$key  = preg_replace( '/[^A-Za-z0-9]/', '', sanitize_text_field( wp_unslash( $_GET['d4u_flash'] ) ) ); // phpcs:ignore
	$data = get_transient( 'd4u_flash_' . $key );
	if ( ! is_array( $data ) ) {
		return '';
	}
	return '<div class="d4u-flash d4u-flash--' . esc_attr( $data[1] ) . '">' . wp_kses_post( $data[0] ) . '</div>';
}

function d4u_back( $text = '', $type = 'ok', $url = '' ) {
	$url = $url ? $url : wp_validate_redirect( wp_get_raw_referer(), home_url( '/' ) );
	$url = remove_query_arg( array( 'd4u_flash', 'd4u_verify', 'u' ), $url );
	if ( $text ) {
		$url = add_query_arg( 'd4u_flash', d4u_flash_set( $text, $type ), $url );
	}
	wp_safe_redirect( $url );
	exit;
}
