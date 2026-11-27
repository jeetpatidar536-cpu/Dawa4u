<?php
/**
 * WooCommerce → dawa4u partners: approve pharmacies and riders, and change the dawa4u charges.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'admin_menu', function () {
	$pending = count( d4u_partners( 'd4u_pharmacy', 'pending' ) ) + count( d4u_partners( 'd4u_rider', 'pending' ) );
	$badge   = $pending ? ' <span class="awaiting-mod">' . (int) $pending . '</span>' : '';
	add_submenu_page( 'woocommerce', 'dawa4u partners', 'dawa4u partners' . $badge, 'manage_woocommerce', 'd4u-partners', 'd4u_admin_page' );
}, 60 );

function d4u_admin_page() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		return;
	}
	$labels = array( 'unverified' => 'Email not verified', 'pending' => 'Waiting for approval', 'approved' => 'Approved', 'suspended' => 'Paused' );
	echo '<div class="wrap"><h1>dawa4u partners</h1>';
	if ( isset( $_GET['done'] ) ) { // phpcs:ignore
		echo '<div class="notice notice-success is-dismissible"><p>Saved.</p></div>';
	}
	echo '<p>Pharmacies and riders sign up on <a href="' . esc_url( d4u_page_url( 'pharmacy' ) ) . '" target="_blank">Pharmacy dashboard</a> and <a href="' . esc_url( d4u_page_url( 'rider' ) ) . '" target="_blank">Rider dashboard</a>. After they verify their email, approve them here. You can also open both dashboards yourself to see and handle every order.</p>';

	foreach ( array( 'd4u_pharmacy' => 'Pharmacies', 'd4u_rider' => 'Riders' ) as $role => $title ) {
		$users = d4u_partners( $role, '' );
		echo '<h2>' . esc_html( $title ) . ' (' . count( $users ) . ')</h2>';
		if ( ! $users ) {
			echo '<p>None yet.</p>';
			continue;
		}
		echo '<table class="widefat striped"><thead><tr><th>Name</th><th>Contact</th><th>Licence</th><th>PIN codes</th><th>Status</th><th></th></tr></thead><tbody>';
		foreach ( $users as $u ) {
			$st = d4u_status( $u->ID );
			echo '<tr><td><strong>' . esc_html( d4u_partner_name( $u->ID ) ) . '</strong>';
			if ( 'd4u_pharmacy' === $role ) {
				echo '<br><small>' . esc_html( $u->display_name ) . '<br>' . esc_html( trim( get_user_meta( $u->ID, 'd4u_address', true ) . ', ' . get_user_meta( $u->ID, 'd4u_city', true ), ', ' ) ) . '</small>';
				echo '<br><small>' . ( 'yes' === get_user_meta( $u->ID, 'd4u_open', true ) ? 'Open' : 'Closed' ) . '</small>';
			} else {
				echo '<br><small>' . esc_html( ucfirst( (string) get_user_meta( $u->ID, 'd4u_vehicle', true ) ) ) . ' · ' . ( 'yes' === get_user_meta( $u->ID, 'd4u_online', true ) ? 'Online' : 'Offline' ) . '</small>';
			}
			echo '</td><td>' . esc_html( $u->user_email ) . ( get_user_meta( $u->ID, 'd4u_email_verified', true ) ? ' <span style="color:#0a7d2a">✓ verified</span>' : '' ) . '<br>' . esc_html( get_user_meta( $u->ID, 'd4u_phone', true ) ) . '</td>';
			echo '<td>' . esc_html( get_user_meta( $u->ID, 'd4u_licence', true ) ) . '</td>';
			echo '<td>' . esc_html( implode( ', ', d4u_pins( $u->ID ) ) ) . '</td>';
			echo '<td>' . esc_html( isset( $labels[ $st ] ) ? $labels[ $st ] : $st ) . '</td><td>';
			$acts = array();
			if ( 'approved' !== $st ) {
				$acts['approved'] = 'Approve';
			}
			if ( 'approved' === $st ) {
				$acts['suspended'] = 'Pause';
			}
			foreach ( $acts as $to => $label ) {
				$url = wp_nonce_url( admin_url( 'admin-post.php?action=d4u_partner&u=' . $u->ID . '&to=' . $to ), 'd4u_partner_' . $u->ID );
				echo '<a class="button' . ( 'approved' === $to ? ' button-primary' : '' ) . '" href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a> ';
			}
			echo '<a class="button-link" href="' . esc_url( get_edit_user_link( $u->ID ) ) . '">Account</a></td></tr>';
		}
		echo '</tbody></table>';
	}

	echo '<h2 style="margin-top:32px">Charges</h2><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
	wp_nonce_field( 'd4u_settings' );
	echo '<input type="hidden" name="action" value="d4u_settings"><table class="form-table">';
	$rows = array(
		'delivery_fee' => array( 'Delivery charge (₹)', 'Free with dawaPass.' ),
		'handling_fee' => array( 'Handling charge (₹)', 'On every medicine order.' ),
		'pass_off'     => array( 'dawaPass discount (%)', 'Off the medicines. The dawaPass price is the price of the “dawaPass — 30 days” product.' ),
		'pass_days'    => array( 'dawaPass length (days)', '' ),
		'rider_pay'    => array( 'Rider pay per delivery (₹)', 'Shown to riders and counted in their earnings.' ),
		'target_min'   => array( 'Delivery promise (minutes)', 'From paid / prescription approved to delivered. Used for delivery times and the zones report.' ),
		'pack_min'     => array( 'Packing target (minutes)', 'Orders waiting longer turn red in the pharmacy dashboard.' ),
		'rain_buffer'  => array( 'Extra minutes when it rains', 'Added to delivery times while it rains in your city. 0 = don’t check the weather.' ),
	);
	foreach ( $rows as $k => $r ) {
		echo '<tr><th><label for="d4u-' . esc_attr( $k ) . '">' . esc_html( $r[0] ) . '</label></th><td><input type="number" min="0" step="1" id="d4u-' . esc_attr( $k ) . '" name="d4u[' . esc_attr( $k ) . ']" value="' . esc_attr( d4u_opt( $k ) ) . '" class="small-text"> <span class="description">' . esc_html( $r[1] ) . '</span></td></tr>';
	}
	$pc = d4u_opt( 'pin_check' );
	echo '<tr><th>Only take orders for covered PIN codes</th><td><select name="d4u[pin_check]">';
	foreach ( array( 'auto' => 'Yes, once at least one pharmacy is approved', 'yes' => 'Yes, always', 'no' => 'No — I will choose the pharmacy myself' ) as $k => $l ) {
		echo '<option value="' . esc_attr( $k ) . '"' . selected( $pc, $k, false ) . '>' . esc_html( $l ) . '</option>';
	}
	echo '</select></td></tr>';
	echo '<tr><th>City for the weather</th><td><input name="d4u[city_lat]" value="' . esc_attr( d4u_opt( 'city_lat' ) ) . '" class="small-text" aria-label="Latitude"> , <input name="d4u[city_lng]" value="' . esc_attr( d4u_opt( 'city_lng' ) ) . '" class="small-text" aria-label="Longitude"> <span class="description">Latitude, longitude. Default: Indore.</span></td></tr></table>';
	submit_button( 'Save charges' );
	echo '</form>';
	if ( function_exists( 'd4u_svc_settings_html' ) ) {
		echo d4u_svc_settings_html(); // phpcs:ignore -- built with esc_* inside
	}
	echo '</div>';
}

add_action( 'admin_post_d4u_partner', function () {
	$uid = isset( $_GET['u'] ) ? absint( $_GET['u'] ) : 0;
	$to  = isset( $_GET['to'] ) ? sanitize_key( $_GET['to'] ) : '';
	if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'd4u_partner_' . $uid ) || ! in_array( $to, array( 'approved', 'suspended' ), true ) ) {
		wp_die( 'Not allowed.' );
	}
	if ( ! d4u_is_pharmacy( $uid ) && ! d4u_is_rider( $uid ) ) {
		wp_die( 'Not a dawa4u partner.' );
	}
	$was = d4u_status( $uid );
	update_user_meta( $uid, 'd4u_status', $to );
	if ( 'approved' === $to && 'approved' !== $was ) {
		$is_ph = d4u_is_pharmacy( $uid );
		$page  = $is_ph ? d4u_page_url( 'pharmacy' ) : d4u_page_url( 'rider' );
		d4u_mail(
			d4u_user_email( $uid ),
			'Your dawa4u account is approved',
			'Welcome to dawa4u',
			'<p>Hello ' . esc_html( d4u_partner_name( $uid ) ) . ',</p><p>Your ' . ( $is_ph ? 'pharmacy' : 'rider' ) . ' account is approved. Log in and tap <strong>' . ( $is_ph ? 'Open' : 'Online' ) . '</strong> to start getting orders.</p><p><a href="' . esc_url( $page ) . '">Open your dashboard</a></p>'
		);
	}
	wp_safe_redirect( admin_url( 'admin.php?page=d4u-partners&done=1' ) );
	exit;
} );

add_action( 'admin_post_d4u_settings', function () {
	if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'd4u_settings' ) ) {
		wp_die( 'Not allowed.' );
	}
	$in  = isset( $_POST['d4u'] ) ? (array) wp_unslash( $_POST['d4u'] ) : array(); // phpcs:ignore
	$out = array();
	foreach ( array( 'delivery_fee', 'handling_fee', 'pass_off', 'pass_days', 'rider_pay', 'target_min', 'pack_min', 'rain_buffer' ) as $k ) {
		if ( isset( $in[ $k ] ) && '' !== $in[ $k ] ) {
			$out[ $k ] = max( 0, (int) $in[ $k ] );
		}
	}
	if ( isset( $out['pass_off'] ) ) {
		$out['pass_off'] = min( 90, $out['pass_off'] );
	}
	if ( isset( $out['pass_days'] ) ) {
		$out['pass_days'] = max( 1, $out['pass_days'] );
	}
	foreach ( array( 'city_lat' => 90, 'city_lng' => 180 ) as $k => $lim ) {
		if ( isset( $in[ $k ] ) && is_numeric( $in[ $k ] ) && abs( (float) $in[ $k ] ) <= $lim ) {
			$out[ $k ] = round( (float) $in[ $k ], 4 );
		}
	}
	delete_transient( 'd4u_rain' );
	delete_transient( 'd4u_pinstats_30' );
	$out['pin_check'] = isset( $in['pin_check'] ) && in_array( $in['pin_check'], array( 'auto', 'yes', 'no' ), true ) ? $in['pin_check'] : 'auto';
	update_option( 'd4u_settings', $out );
	wp_safe_redirect( admin_url( 'admin.php?page=d4u-partners&done=1' ) );
	exit;
} );

// Show partner details on the user's profile screen too.
add_action( 'show_user_profile', 'd4u_user_box' );
add_action( 'edit_user_profile', 'd4u_user_box' );
function d4u_user_box( $user ) {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		return;
	}
	$pass = d4u_pass_until( $user->ID );
	echo '<h2>dawa4u</h2><table class="form-table">';
	echo '<tr><th>dawaPass</th><td>' . ( $pass > time() ? 'Active until ' . esc_html( date_i18n( 'j M Y', $pass ) ) : 'Not active' ) . '</td></tr>';
	if ( d4u_is_pharmacy( $user->ID ) || d4u_is_rider( $user->ID ) ) {
		echo '<tr><th>Partner status</th><td>' . esc_html( d4u_status( $user->ID ) ) . ' — change it in <a href="' . esc_url( admin_url( 'admin.php?page=d4u-partners' ) ) . '">dawa4u partners</a></td></tr>';
	}
	echo '</table>';
}
