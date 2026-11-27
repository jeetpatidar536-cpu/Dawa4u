<?php
/**
 * dawa4u inside the phone apps (Android, Capacitor) and the Windows pharmacy app (Electron).
 *
 * The apps open this website and add "dawa4uApp/<customer|rider|pharmacy-desktop>" to the browser's user agent.
 * Here the site notices that and looks like an app: a bottom tab bar for customers, no website footer or menu,
 * and the rider app keeps the rider on the rider screens. It is decided in the browser (not on the server),
 * so a cached page is still right for both the website and the apps.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'wp_head', function () {
	echo "<script>(function(){var m=navigator.userAgent.match(/dawa4uApp\\/([a-z-]+)/);if(m){var c=document.documentElement.classList;c.add('d4u-app','d4u-app--'+m[1])}})();</script>\n";
}, 0 );

function d4u_tab_icon( $name ) {
	$p = array(
		'home'   => '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
		'pill'   => '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M8.5 8.5l7 7"/>',
		'rx'     => '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9 13h6M9 17h4"/>',
		'orders' => '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
		'user'   => '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
	);
	return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . $p[ $name ] . '</svg>';
}

add_action( 'wp_footer', function () {
	if ( ! function_exists( 'WC' ) ) {
		return;
	}
	$rx      = d4u_page_url( 'rx' );
	$current = 'home';
	if ( is_shop() || is_product() || is_product_category() || is_product_tag() ) {
		$current = 'shop';
	} elseif ( $rx && is_page( (int) get_option( 'd4u_page_rx' ) ) ) {
		$current = 'rx';
	} elseif ( is_wc_endpoint_url( 'orders' ) || is_wc_endpoint_url( 'view-order' ) || is_order_received_page() ) {
		$current = 'orders';
	} elseif ( is_account_page() ) {
		$current = 'account';
	} elseif ( ! is_front_page() ) {
		$current = '';
	}
	$tabs = array(
		'home'    => array( home_url( '/' ), 'Home', 'home' ),
		'shop'    => array( wc_get_page_permalink( 'shop' ), 'Medicines', 'pill' ),
		'rx'      => array( $rx ? $rx : home_url( '/upload-prescription/' ), 'Prescription', 'rx' ),
		'orders'  => array( wc_get_account_endpoint_url( 'orders' ), 'Orders', 'orders' ),
		'account' => array( wc_get_page_permalink( 'myaccount' ), 'Account', 'user' ),
	);
	echo '<nav class="d4u-tabbar" aria-label="App">';
	foreach ( $tabs as $key => $t ) {
		echo '<a href="' . esc_url( $t[0] ) . '"' . ( $key === $current ? ' class="is-on" aria-current="page"' : '' ) . '>' . d4u_tab_icon( $t[2] ) . '<span>' . esc_html( $t[1] ) . '</span></a>'; // phpcs:ignore -- icon is fixed markup
	}
	echo '</nav>';
	// In the rider app the logo leads back to the rider screen, not the shop.
	$rider = d4u_page_url( 'rider' );
	echo "<script>(function(){var c=document.documentElement.classList;if(c.contains('d4u-app--rider')){var b=document.querySelector('.d4-brand');if(b)b.href=" . wp_json_encode( $rider ) . ";if(location.pathname==='/'||location.pathname==='')location.replace(" . wp_json_encode( $rider ) . ")}})();</script>\n";
}, 20 );
