<?php
/**
 * [dawa4u_medicines] — medicines from the WooCommerce shop.
 *
 * [dawa4u_medicines]            the full list
 * [dawa4u_medicines limit="8"]  a short list of everyday medicines (home page) with a "See all" link
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_shortcode( 'dawa4u_medicines', function ( $atts ) {
	$a = shortcode_atts( array( 'limit' => 0 ), $atts, 'dawa4u_medicines' );
	if ( ! class_exists( 'WooCommerce' ) ) {
		return '';
	}
	$limit = (int) $a['limit'];
	if ( $limit ) {
		$everyday = 'd4u-p1,d4u-p5,d4u-p31,d4u-p15,d4u-p36,d4u-p32,d4u-p14,d4u-p27';
		$out      = do_shortcode( '[products skus="' . $everyday . '" limit="' . $limit . '" columns="4" orderby="menu_order" order="ASC"]' );
		if ( false === strpos( $out, 'product' ) ) {
			$out = do_shortcode( '[products limit="' . $limit . '" columns="4" orderby="menu_order" order="ASC"]' );
		}
		return $out . '<p class="d4m-more"><a href="' . esc_url( dawa4u_url( 'shop' ) ) . '">See all medicines →</a></p>';
	}
	return do_shortcode( '[products limit="48" columns="4" orderby="menu_order" order="ASC" paginate="true"]' );
} );

/** "My account" in the phone menu (the header icon is hidden on small phones). */
add_filter( 'wp_nav_menu_items', function ( $items, $args ) {
	if ( isset( $args->theme_location ) && 'primary' === $args->theme_location && class_exists( 'WooCommerce' ) ) {
		$items .= '<li class="d4-only-phone"><a href="' . esc_url( dawa4u_url( 'account' ) ) . '">' . ( is_user_logged_in() ? 'My account' : 'Log in' ) . '</a></li>';
	}
	return $items;
}, 10, 2 );
