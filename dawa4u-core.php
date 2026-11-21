<?php
/**
 * Plugin Name:       dawa4u core
 * Plugin URI:        https://dawa4u.in/
 * Description:       dawa4u on WooCommerce: the medicine list, prescriptions checked by a licensed pharmacist, dawaPass (₹100 a month), delivery charges, and the pharmacy and rider dashboards.
 * Version:           1.0.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Requires Plugins:  woocommerce
 * Author:            dawa4u
 * License:           GPLv2 or later
 * Text Domain:       dawa4u
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'D4U_VER', '1.0.0' );
define( 'D4U_FILE', __FILE__ );
define( 'D4U_DIR', plugin_dir_path( __FILE__ ) );
define( 'D4U_URL', plugin_dir_url( __FILE__ ) );

add_action( 'before_woocommerce_init', function () {
	if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
} );

require_once D4U_DIR . 'inc/helpers.php';

/** Partner roles: a pharmacy account and a rider account. Both can only "read" — no wp-admin. */
function d4u_add_roles() {
	if ( ! get_role( 'd4u_pharmacy' ) ) {
		add_role( 'd4u_pharmacy', 'dawa4u pharmacy', array( 'read' => true ) );
	}
	if ( ! get_role( 'd4u_rider' ) ) {
		add_role( 'd4u_rider', 'dawa4u rider', array( 'read' => true ) );
	}
}
register_activation_hook( __FILE__, function () {
	d4u_add_roles();
	update_option( 'd4u_flush', 1 );
} );

add_action( 'plugins_loaded', function () {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', function () {
			echo '<div class="notice notice-error"><p><strong>dawa4u core</strong> needs WooCommerce. Please activate WooCommerce.</p></div>';
		} );
		return;
	}
	require_once D4U_DIR . 'inc/setup.php';
	require_once D4U_DIR . 'inc/orders.php';
	require_once D4U_DIR . 'inc/checkout.php';
	require_once D4U_DIR . 'inc/partners.php';
	require_once D4U_DIR . 'inc/dashboards.php';
	require_once D4U_DIR . 'inc/admin.php';
} );

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'dawa4u-core', D4U_URL . 'assets/core.css', array(), D4U_VER );
}, 20 );
