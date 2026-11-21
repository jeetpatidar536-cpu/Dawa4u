<?php
/**
 * One-time store setup. Runs once per version; every step is safe to run again.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'D4U_SETUP', 1 );

add_action( 'wp_loaded', 'd4u_setup' );

function d4u_setup() {
	if ( (int) get_option( 'd4u_setup' ) >= D4U_SETUP ) {
		if ( get_option( 'd4u_flush' ) ) {
			delete_option( 'd4u_flush' );
			flush_rewrite_rules( false );
		}
		return;
	}
	if ( get_transient( 'd4u_setup_lock' ) ) {
		return;
	}
	set_transient( 'd4u_setup_lock', 1, 5 * MINUTE_IN_SECONDS );
	if ( function_exists( 'set_time_limit' ) ) {
		@set_time_limit( 300 ); // phpcs:ignore
	}

	d4u_add_roles();
	d4u_setup_store();
	$imgs = d4u_setup_images();
	d4u_setup_categories( $imgs );
	d4u_setup_products( $imgs );
	d4u_setup_pass( $imgs );
	d4u_setup_pages();
	d4u_setup_shipping();
	d4u_setup_payments();
	d4u_rx_dir();

	update_option( 'd4u_setup', D4U_SETUP );
	delete_transient( 'd4u_setup_lock' );
	delete_option( 'd4u_flush' );
	flush_rewrite_rules( false );
}

function d4u_setup_store() {
	$opts = array(
		'woocommerce_currency'                              => 'INR',
		'woocommerce_currency_pos'                          => 'left',
		'woocommerce_price_num_decimals'                    => '0',
		'woocommerce_price_thousand_sep'                    => ',',
		'woocommerce_price_decimal_sep'                     => '.',
		'woocommerce_allowed_countries'                     => 'specific',
		'woocommerce_specific_allowed_countries'            => array( 'IN' ),
		'woocommerce_ship_to_countries'                     => '',
		'woocommerce_calc_taxes'                            => 'no',
		'woocommerce_enable_coupons'                        => 'no',
		'woocommerce_manage_stock'                          => 'no',
		'woocommerce_enable_guest_checkout'                 => 'no',
		'woocommerce_enable_checkout_login_reminder'        => 'yes',
		'woocommerce_enable_signup_and_login_from_checkout' => 'yes',
		'woocommerce_enable_myaccount_registration'         => 'yes',
		'woocommerce_registration_generate_username'        => 'yes',
		'woocommerce_registration_generate_password'        => 'no',
		'woocommerce_ship_to_destination'                   => 'billing_only',
		'woocommerce_enable_shipping_calc'                  => 'no',
		'woocommerce_shipping_cost_requires_address'        => 'no',
		'woocommerce_enable_ajax_add_to_cart'               => 'yes',
		'woocommerce_cart_redirect_after_add'               => 'no',
		'woocommerce_enable_reviews'                        => 'no',
		'woocommerce_email_from_name'                       => 'dawa4u',
		'woocommerce_default_customer_address'              => 'base',
	);
	foreach ( $opts as $k => $v ) {
		update_option( $k, $v );
	}
	// The "completed" email goes out when the rider delivers.
	$done = get_option( 'woocommerce_customer_completed_order_settings', array() );
	$done = array_merge( is_array( $done ) ? $done : array(), array(
		'subject' => 'Delivered — your dawa4u order #{order_number}',
		'heading' => 'Your medicines were delivered',
	) );
	update_option( 'woocommerce_customer_completed_order_settings', $done );

	$country = (string) get_option( 'woocommerce_default_country' );
	if ( 0 !== strpos( $country, 'IN' ) ) {
		update_option( 'woocommerce_default_country', 'IN' );
	}
}

/** Put the medicine pictures in the Media Library. */
function d4u_setup_images() {
	$have = get_option( 'd4u_images', array() );
	if ( ! is_array( $have ) ) {
		$have = array();
	}
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	foreach ( array_merge( array_keys( d4u_cats() ), array( 'pass' ) ) as $k ) {
		if ( ! empty( $have[ $k ] ) && get_post( $have[ $k ] ) ) {
			continue;
		}
		$src = D4U_DIR . 'assets/img/' . $k . '.png';
		if ( ! file_exists( $src ) ) {
			continue;
		}
		$tmp = wp_tempnam( 'dawa4u-' . $k . '.png' );
		if ( ! $tmp || ! copy( $src, $tmp ) ) {
			continue;
		}
		$label = 'pass' === $k ? 'dawaPass' : d4u_cats()[ $k ][1];
		$id    = media_handle_sideload( array( 'name' => 'dawa4u-' . $k . '.png', 'tmp_name' => $tmp ), 0, $label );
		if ( is_wp_error( $id ) ) {
			@unlink( $tmp ); // phpcs:ignore
			continue;
		}
		update_post_meta( $id, '_wp_attachment_image_alt', $label );
		$have[ $k ] = $id;
		update_option( 'd4u_images', $have, false );
	}
	return $have;
}

function d4u_setup_categories( $imgs ) {
	$ids = array();
	$i   = 0;
	foreach ( d4u_cats() as $k => $c ) {
		$t = get_term_by( 'slug', $c[0], 'product_cat' );
		if ( $t ) {
			$tid = $t->term_id;
		} else {
			$r = wp_insert_term( $c[1], 'product_cat', array( 'slug' => $c[0] ) );
			if ( is_wp_error( $r ) ) {
				continue;
			}
			$tid = $r['term_id'];
		}
		if ( ! empty( $imgs[ $k ] ) && ! get_term_meta( $tid, 'thumbnail_id', true ) ) {
			update_term_meta( $tid, 'thumbnail_id', $imgs[ $k ] );
		}
		update_term_meta( $tid, 'order', $i++ );
		$ids[ $k ] = $tid;
	}
	update_option( 'd4u_cat_ids', $ids, false );
	return $ids;
}

function d4u_med_description( $m ) {
	$d  = '<p><strong>Contains:</strong> ' . esc_html( $m['salt'] ) . '</p>';
	$d .= '<p><strong>Pack:</strong> ' . esc_html( $m['pack'] ) . '</p>';
	if ( ! empty( $m['rx'] ) ) {
		$d .= '<p><strong>Needs a prescription.</strong> Add a photo of your prescription at checkout. A licensed pharmacist checks it before your order is packed.</p>';
	}
	$d .= '<p>Sold and delivered by a licensed dawa4u partner pharmacy near you. Price shown is the MRP.</p>';
	return $d;
}

/** The 40 medicines from the old apps, as WooCommerce products (skips any that already exist). */
function d4u_setup_products( $imgs ) {
	$cats = get_option( 'd4u_cat_ids', array() );
	$list = json_decode( (string) file_get_contents( D4U_DIR . 'data/medicines.json' ), true ); // phpcs:ignore
	if ( ! is_array( $list ) ) {
		return;
	}
	$rank = array_flip( array_keys( d4u_cats() ) ); // list fever & pain first, devices last
	foreach ( $list as $i => $m ) {
		$sku = 'd4u-' . $m['id'];
		if ( wc_get_product_id_by_sku( $sku ) ) {
			continue;
		}
		$p = new WC_Product_Simple();
		$p->set_name( $m['name'] );
		$p->set_status( 'publish' );
		$p->set_catalog_visibility( 'visible' );
		$p->set_sku( $sku );
		$p->set_regular_price( (string) $m['mrp'] );
		$p->set_tax_status( 'none' );
		$p->set_reviews_allowed( false );
		$p->set_menu_order( ( isset( $rank[ $m['category'] ] ) ? $rank[ $m['category'] ] : 9 ) * 100 + $i );
		$p->set_short_description( esc_html( trim( $m['salt'] . ' · ' . $m['pack'], ' ·' ) ) );
		$p->set_description( d4u_med_description( $m ) );
		if ( ! empty( $cats[ $m['category'] ] ) ) {
			$p->set_category_ids( array( (int) $cats[ $m['category'] ] ) );
		}
		if ( ! empty( $imgs[ $m['category'] ] ) ) {
			$p->set_image_id( (int) $imgs[ $m['category'] ] );
		}
		$p->update_meta_data( '_d4u_rx', ! empty( $m['rx'] ) ? 'yes' : 'no' );
		$p->update_meta_data( '_d4u_salt', $m['salt'] );
		$p->update_meta_data( '_d4u_pack', $m['pack'] );
		$p->update_meta_data( '_d4u_old_id', $m['id'] );
		$p->save();
	}
}

/** dawaPass: ₹100 for 30 days. Hidden from the medicine list; bought from the dawaPass page or the cart. */
function d4u_setup_pass( $imgs ) {
	$id = d4u_pass_product_id();
	if ( $id && get_post( $id ) ) {
		return $id;
	}
	$id = wc_get_product_id_by_sku( 'd4u-pass' );
	if ( ! $id ) {
		$p = new WC_Product_Simple();
		$p->set_name( 'dawaPass — 30 days' );
		$p->set_slug( 'dawapass-30-days' );
		$p->set_status( 'publish' );
		$p->set_catalog_visibility( 'hidden' );
		$p->set_sku( 'd4u-pass' );
		$p->set_virtual( true );
		$p->set_sold_individually( true );
		$p->set_regular_price( '100' );
		$p->set_tax_status( 'none' );
		$p->set_reviews_allowed( false );
		$p->set_short_description( '15% off medicines, free delivery and priority packing for 30 days.' );
		$p->set_description( '<p>dawaPass costs ₹100 and lasts 30 days from the day you pay. While it is active you get <strong>15% off</strong> medicines, <strong>free delivery</strong> on every order, and your orders are packed first.</p><p>Buying it again before it ends adds another 30 days.</p>' );
		if ( ! empty( $imgs['pass'] ) ) {
			$p->set_image_id( (int) $imgs['pass'] );
		}
		$id = $p->save();
	}
	update_option( 'd4u_pass_product', (int) $id );
	return $id;
}

function d4u_shortcode_block( $sc ) {
	return "<!-- wp:shortcode -->\n{$sc}\n<!-- /wp:shortcode -->";
}

function d4u_setup_pages() {
	$pages = array(
		'pharmacy' => array( 'pharmacy-dashboard', 'Pharmacy dashboard', '[dawa4u_pharmacy]' ),
		'rider'    => array( 'rider-dashboard', 'Rider dashboard', '[dawa4u_rider]' ),
		'rx'       => array( 'upload-prescription', 'Upload prescription', '[dawa4u_rx_upload]' ),
	);
	foreach ( $pages as $k => $pg ) {
		$id = (int) get_option( 'd4u_page_' . $k );
		if ( ! $id || ! get_post( $id ) ) {
			$existing = get_page_by_path( $pg[0], OBJECT, 'page' );
			$id       = $existing ? $existing->ID : wp_insert_post( array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => $pg[1],
				'post_name'    => $pg[0],
				'post_content' => d4u_shortcode_block( $pg[2] ),
			) );
		}
		if ( $id && ! is_wp_error( $id ) ) {
			update_option( 'd4u_page_' . $k, (int) $id );
		}
	}

	// The Medicines page becomes the WooCommerce shop (dawa4u.in/medicines/). /shop/ is the old app folder.
	$lead    = 'Medicines from licensed partner pharmacies near you. Items marked <strong>Needs prescription</strong> are checked by a licensed pharmacist before your order is packed.';
	$med     = get_page_by_path( 'medicines', OBJECT, 'page' );
	$shop_id = (int) get_option( 'woocommerce_shop_page_id' );
	if ( $med ) {
		if ( $shop_id && $shop_id !== (int) $med->ID && 'shop' === get_post_field( 'post_name', $shop_id ) ) {
			wp_trash_post( $shop_id );
		}
		update_option( 'woocommerce_shop_page_id', (int) $med->ID );
		wp_update_post( array(
			'ID'           => $med->ID,
			'post_content' => "<!-- wp:paragraph {\"className\":\"d4-lead\"} -->\n<p class=\"d4-lead\">{$lead}</p>\n<!-- /wp:paragraph -->",
		) );
	} elseif ( $shop_id ) {
		wp_update_post( array( 'ID' => $shop_id, 'post_name' => 'medicines', 'post_title' => 'Medicines' ) );
	}

	// Classic cart and checkout (the checkout needs the prescription upload box).
	foreach ( array( 'cart' => '[woocommerce_cart]', 'checkout' => '[woocommerce_checkout]' ) as $k => $sc ) {
		$pid = wc_get_page_id( $k );
		if ( $pid > 0 && false === strpos( (string) get_post_field( 'post_content', $pid ), $sc ) ) {
			wp_update_post( array( 'ID' => $pid, 'post_content' => d4u_shortcode_block( $sc ) ) );
		}
	}
	$acc = wc_get_page_id( 'myaccount' );
	if ( $acc > 0 ) {
		$c = (string) get_post_field( 'post_content', $acc );
		if ( false === strpos( $c, '[woocommerce_my_account]' ) && false === strpos( $c, 'woocommerce/classic-shortcode' ) ) {
			wp_update_post( array( 'ID' => $acc, 'post_content' => d4u_shortcode_block( '[woocommerce_my_account]' ) ) );
		}
	}

	// Wording that belonged to the old apps.
	$swap = array(
		'A licensed pharmacist verifies your prescription before you pay.' => 'A licensed pharmacist checks your prescription before your order is packed.',
		'Upload a photo of it. A licensed pharmacist verifies it before you pay.' => 'Add a photo of it at checkout, or send it first from Upload prescription. A licensed pharmacist checks it before your order is packed.',
		'The rider app works in English and Hindi' => 'A simple rider dashboard on your phone',
		'Add dawaPass to your cart in the dawa4u app or website and pay with your order.' => 'Tap Join dawaPass and pay ₹100 — on its own or with your order.',
		'Open Orders in the app to see the live tracker and call your rider.' => 'Open My account → Orders. When your order is on the way you will see your rider’s name and phone number.',
		'₹100 a month for 15–20% off, free delivery and priority fulfilment. It lasts 30 days.' => '₹100 for 30 days: 15% off medicines, free delivery and priority packing.',
		'<strong>15–20% off</strong> medicines on every order' => '<strong>15% off</strong> medicines on every order',
		'dawaPass members pay ₹100 a month for 15–20% off medicines, free delivery and priority fulfilment.' => 'dawaPass members pay ₹100 a month for 15% off medicines, free delivery and priority packing.',
		'If your order can still be cancelled, you will see a Cancel button on it in Orders in the app or website.' => 'If your order has not been paid or packed yet, you will see a Cancel button on it in My account → Orders. Otherwise, write to us from the Help page.',
		'If something is wrong with your refund, write to us from Help &amp; support in the app and we will look into it.' => 'If something is wrong with your refund, write to us from the Help page and we will look into it.',
		'Log in to the dawa4u app or website and open Help &amp; support to send us a message. You will see our reply there.' => 'Send us a message with the form below. We reply by email or phone.',
	);
	foreach ( array( 'home', 'dawapass', 'partners', 'about', 'help', 'refunds' ) as $slug ) {
		$pg = get_page_by_path( $slug, OBJECT, 'page' );
		if ( ! $pg ) {
			continue;
		}
		$c = str_replace( array_keys( $swap ), array_values( $swap ), $pg->post_content );
		if ( 'help' === $slug && false === strpos( $c, 'dawa4u_contact' ) ) {
			// Replace the old "Open Help & support" button with the message form.
			$c = preg_replace( '#<!-- wp:buttons -->(?:(?!<!-- /wp:buttons -->).)*shop/\#/help(?:(?!<!-- /wp:buttons -->).)*<!-- /wp:buttons -->#s', d4u_shortcode_block( '[dawa4u_contact]' ), $c, 1, $n );
			if ( ! $n ) {
				$c .= "\n" . d4u_shortcode_block( '[dawa4u_contact]' );
			}
		}
		$pass = d4u_pass_product_id();
		if ( $pass && in_array( $slug, array( 'home', 'dawapass' ), true ) ) {
			$join = esc_url( add_query_arg( 'add-to-cart', $pass, wc_get_cart_url() ) );
			$c    = preg_replace( '#href="[^"]*"(>Join dawaPass</a>)#', 'href="' . $join . '"$1', $c );
		}
		if ( $c !== $pg->post_content ) {
			wp_update_post( array( 'ID' => $pg->ID, 'post_content' => $c ) );
		}
	}
}

/** One delivery zone (India) with a flat delivery charge. The amount itself comes from the dawa4u settings. */
function d4u_setup_shipping() {
	if ( ! class_exists( 'WC_Shipping_Zones' ) ) {
		return;
	}
	foreach ( WC_Shipping_Zones::get_zones() as $z ) {
		foreach ( (array) $z['zone_locations'] as $loc ) {
			if ( 'IN' === $loc->code && 'country' === $loc->type ) {
				$has_flat = false;
				foreach ( (array) $z['shipping_methods'] as $m ) {
					if ( 'flat_rate' === $m->id ) {
						$has_flat = true;
					}
				}
				if ( ! $has_flat ) {
					$zone = new WC_Shipping_Zone( $z['id'] );
					$iid  = $zone->add_shipping_method( 'flat_rate' );
					update_option( 'woocommerce_flat_rate_' . $iid . '_settings', array( 'title' => 'Delivery', 'tax_status' => 'none', 'cost' => (string) d4u_opt( 'delivery_fee' ) ) );
				}
				return;
			}
		}
	}
	$zone = new WC_Shipping_Zone();
	$zone->set_zone_name( 'India' );
	$zone->set_zone_order( 0 );
	$zone->add_location( 'IN', 'country' );
	$zone->save();
	$iid = $zone->add_shipping_method( 'flat_rate' );
	update_option( 'woocommerce_flat_rate_' . $iid . '_settings', array( 'title' => 'Delivery', 'tax_status' => 'none', 'cost' => (string) d4u_opt( 'delivery_fee' ) ) );
}

/** Cash on delivery + UPI to dawa4u's UPI ID (no reference number asked). Razorpay off. Cashfree is set up by the owner with their keys. */
function d4u_setup_payments() {
	$cod = get_option( 'woocommerce_cod_settings', array() );
	$cod = array_merge( is_array( $cod ) ? $cod : array(), array(
		'enabled'            => 'yes',
		'title'              => 'Cash on delivery',
		'description'        => 'Pay the rider in cash when your medicines arrive.',
		'instructions'       => 'Please keep the amount ready for the rider.',
		'enable_for_methods' => array(),
		'enable_for_virtual' => 'no',
	) );
	update_option( 'woocommerce_cod_settings', $cod );

	$upi = get_option( 'woocommerce_wc-upi_settings', array() );
	$upi = array_merge( is_array( $upi ) ? $upi : array(), array(
		'enabled'           => 'yes',
		'title'             => 'UPI — scan and pay',
		'description'       => 'Pay with any UPI app (PhonePe, Google Pay, Paytm, BHIM). We check the payment and then send your order.',
		'vpa'               => '9669846911@fam',
		'name'              => 'dawa4u',
		'upi_address'       => 'hide',
		'require_upi'       => 'no',
		'transaction_id'    => 'hide',
		'transaction_image' => 'hide',
		'payment_status'    => 'on-hold',
	) );
	update_option( 'woocommerce_wc-upi_settings', $upi );

	$rz = get_option( 'woocommerce_razorpay_settings' );
	if ( is_array( $rz ) ) {
		$rz['enabled'] = 'no';
		update_option( 'woocommerce_razorpay_settings', $rz );
	}

	$order = get_option( 'woocommerce_gateway_order', array() );
	$order = is_array( $order ) ? $order : array();
	$order = array_merge( $order, array( 'cashfree' => 0, 'wc-upi' => 1, 'cod' => 2 ) );
	update_option( 'woocommerce_gateway_order', $order );
}
