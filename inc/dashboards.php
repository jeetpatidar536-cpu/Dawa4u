<?php
/**
 * [dawa4u_pharmacy] and [dawa4u_rider] — the dashboards that replace the old pharmacy and rider apps.
 * The dawa4u team (shop managers / admins) can open both and see every order.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ------------------------------------------------------------------ shared bits */

function d4u_orders_for( $field, $uid, $statuses, $limit = 60, $order = 'ASC' ) {
	$args = array(
		'status'  => (array) $statuses,
		'limit'   => $limit,
		'orderby' => 'date',
		'order'   => $order,
	);
	if ( $field && ! d4u_is_boss( $uid ) ) {
		$args['meta_query'] = array( array( 'key' => $field, 'value' => (string) (int) $uid ) ); // phpcs:ignore
	}
	return wc_get_orders( $args );
}

function d4u_ago( $order ) {
	$d = $order->get_date_created();
	return $d ? human_time_diff( $d->getTimestamp(), time() ) . ' ago' : '';
}

function d4u_maps_link( $text ) {
	return 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode( $text );
}

function d4u_order_address( $order ) {
	$parts = array_filter( array(
		$order->get_shipping_address_1() ? $order->get_shipping_address_1() : $order->get_billing_address_1(),
		$order->get_shipping_address_2() ? $order->get_shipping_address_2() : $order->get_billing_address_2(),
		$order->get_shipping_city() ? $order->get_shipping_city() : $order->get_billing_city(),
		d4u_order_pin( $order ),
	) );
	return implode( ', ', $parts );
}

function d4u_pay_line( $order ) {
	if ( 'cod' === $order->get_payment_method() ) {
		return '<span class="d4u-pill d4u-pill--warn">Cash on delivery · collect ' . wp_kses_post( wc_price( $order->get_total() ) ) . '</span>';
	}
	if ( $order->is_paid() || $order->get_date_paid() ) {
		return '<span class="d4u-pill d4u-pill--ok">Paid · ' . wp_kses_post( wc_price( $order->get_total() ) ) . '</span>';
	}
	return '<span class="d4u-pill">' . wp_kses_post( wc_price( $order->get_total() ) ) . ' · not paid yet</span>';
}

function d4u_items_html( $order ) {
	$items = $order->get_items();
	if ( ! $items ) {
		return '<p class="d4u-small">No medicines added yet.</p>';
	}
	$ph    = (int) $order->get_meta( '_d4u_pharmacy' );
	$stock = ( $ph && get_current_user_id() === $ph && function_exists( 'd4u_stock' ) ) ? d4u_stock( $ph ) : array(); // only the pharmacy sees its own stock
	$out   = '<ul class="d4u-items">';
	foreach ( $items as $item ) {
		$p    = $item->get_product();
		$sku  = $p ? $p->get_sku() : '';
		$st   = ( $sku && isset( $stock[ $sku ] ) ) ? (int) $stock[ $sku ]['qty'] : null;
		$tag  = null === $st ? '' : ' <span class="d4u-stock' . ( $st < $item->get_quantity() ? ' is-low' : '' ) . '">' . ( $st ? 'stock ' . $st : 'out of stock' ) . '</span>';
		$out .= '<li><span>' . esc_html( $item->get_name() ) . ( $p && d4u_needs_rx( $p ) ? ' <span class="d4u-rx-tag">Rx</span>' : '' ) . $tag . '</span><b>× ' . esc_html( $item->get_quantity() ) . '</b></li>';
	}
	return $out . '</ul>';
}

function d4u_files_html( $order ) {
	$files = array_values( array_filter( (array) $order->get_meta( '_d4u_rx_files' ) ) );
	if ( ! $files ) {
		return '';
	}
	$out = '<div class="d4u-files">';
	foreach ( $files as $i => $f ) {
		$url  = d4u_rx_file_url( $order, $i );
		$img  = 0 === strpos( (string) $f['type'], 'image/' ) && 'image/heic' !== $f['type'];
		$out .= '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener">' . ( $img ? '<img src="' . esc_url( $url ) . '" alt="Prescription" loading="lazy">' : '<span>📄 ' . esc_html( $f['name'] ) . '</span>' ) . '</a>';
	}
	return $out . '</div>';
}

function d4u_action_btn( $action, $order, $label, $class = '', $extra = '' ) {
	return d4u_form_open( $action, 'd4u-inline' ) . '<input type="hidden" name="order" value="' . esc_attr( $order->get_id() ) . '">' . $extra . '<button class="d4u-btn ' . esc_attr( $class ) . '" type="submit">' . esc_html( $label ) . '</button></form>';
}

/** Load an order and check the person may act on it. */
function d4u_acting_order( $field, $statuses ) {
	$uid   = get_current_user_id();
	$order = wc_get_order( isset( $_POST['order'] ) ? absint( $_POST['order'] ) : 0 ); // phpcs:ignore
	if ( ! $order ) {
		d4u_back( 'Order not found.', 'error' );
	}
	if ( ! d4u_is_boss( $uid ) ) {
		if ( 'approved' !== d4u_status( $uid ) ) {
			d4u_back( 'Your account is not approved yet.', 'error' );
		}
		if ( $field && (int) $order->get_meta( $field ) !== $uid ) {
			d4u_back( 'This order is not yours.', 'error' );
		}
	}
	if ( $statuses && ! $order->has_status( $statuses ) ) {
		d4u_back( 'Order #' . $order->get_order_number() . ' has already moved on (' . wc_get_order_status_name( $order->get_status() ) . ').', 'error' );
	}
	return $order;
}

function d4u_refresh_script() {
	// Reload every 45 s to show new orders — but not while someone is typing.
	return '<script>(function(){var t=0;document.addEventListener("input",function(){t=Date.now()});setInterval(function(){if(!document.hidden&&Date.now()-t>60000&&!document.querySelector("form.d4u-dirty"))location.reload()},45000);document.addEventListener("change",function(e){var f=e.target.closest&&e.target.closest("form");if(f)f.classList.add("d4u-dirty")})})();</script>';
}

function d4u_gate( $role, $kind ) {
	$out = d4u_flash_html();
	if ( ! is_user_logged_in() ) {
		return array( false, $out . d4u_auth_screen( $kind ) );
	}
	$uid = get_current_user_id();
	if ( d4u_is_boss( $uid ) ) {
		return array( true, $out . '<p class="d4u-boss">You are viewing this as the dawa4u team — you see every ' . ( 'pharmacy' === $kind ? 'pharmacy' : 'rider' ) . '’s orders and can act on them.</p>' );
	}
	if ( ! d4u_has_role( $uid, $role ) ) {
		return array( false, $out . '<div class="d4u-card"><p>This page is for dawa4u ' . ( 'pharmacy' === $kind ? 'partner pharmacies' : 'riders' ) . '. You are logged in with a different account.</p><p><a class="d4u-btn d4u-btn--ghost" href="' . esc_url( wp_logout_url( get_permalink() ) ) . '">Log out</a></p></div>' );
	}
	$st = d4u_status( $uid );
	if ( 'approved' !== $st ) {
		$msg = 'suspended' === $st ? 'Your account is paused. Please contact the dawa4u team.' : 'Thank you for signing up! The dawa4u team is checking your details. We’ll email you as soon as your account is approved.';
		return array( false, $out . '<div class="d4u-card"><h3>' . ( 'suspended' === $st ? 'Account paused' : 'Waiting for approval' ) . '</h3><p>' . esc_html( $msg ) . '</p><p><a class="d4u-btn d4u-btn--ghost" href="' . esc_url( wp_logout_url( get_permalink() ) ) . '">Log out</a></p></div>' );
	}
	return array( true, $out );
}

function d4u_tabs( $tabs, $current ) {
	$out = '<nav class="d4u-tabs">';
	foreach ( $tabs as $k => $label ) {
		$out .= '<a class="' . ( $k === $current ? 'on' : '' ) . '" href="' . esc_url( add_query_arg( 'tab', $k, remove_query_arg( array( 'd4u_flash' ) ) ) ) . '">' . $label . '</a>';
	}
	return $out . '</nav>';
}

/* ------------------------------------------------------------------ pharmacy dashboard */

add_shortcode( 'dawa4u_pharmacy', function () {
	list( $ok, $out ) = d4u_gate( 'd4u_pharmacy', 'pharmacy' );
	if ( ! $ok ) {
		return '<div class="d4u-dash">' . $out . '</div>';
	}
	$uid  = get_current_user_id();
	$boss = d4u_is_boss( $uid );
	$tab  = isset( $_GET['tab'] ) ? sanitize_key( $_GET['tab'] ) : 'orders'; // phpcs:ignore

	$rx      = d4u_orders_for( '_d4u_pharmacy', $uid, 'd4u-rx' );
	$pack    = d4u_orders_for( '_d4u_pharmacy', $uid, 'processing' );
	$waiting = d4u_orders_for( '_d4u_pharmacy', $uid, array( 'd4u-ready', 'd4u-out' ) );
	$reqs    = d4u_orders_for( '_d4u_pharmacy', $uid, 'd4u-request' );

	$out .= '<div class="d4u-dash">';
	if ( ! $boss ) {
		$open  = 'yes' === get_user_meta( $uid, 'd4u_open', true );
		$out  .= '<div class="d4u-head d4u-card"><div><h2>' . esc_html( d4u_partner_name( $uid ) ) . '</h2><p class="d4u-small">Delivers to ' . esc_html( implode( ', ', d4u_pins( $uid ) ) ) . '</p></div>';
		$out  .= d4u_form_open( 'ph_open', 'd4u-inline' ) . '<button class="d4u-switch ' . ( $open ? 'is-on' : '' ) . '" type="submit">' . ( $open ? 'Open — taking orders' : 'Closed — tap to open' ) . '</button></form></div>';
		if ( ! $open ) {
			$out .= '<p class="d4u-flash d4u-flash--warn">You are closed. New orders go to another pharmacy near the customer if one is open.</p>';
		}
	}
	$out .= d4u_tabs( array(
		'orders'   => 'Orders <span class="d4u-count">' . ( count( $rx ) + count( $pack ) ) . '</span>',
		'requests' => 'Prescriptions <span class="d4u-count">' . count( $reqs ) . '</span>',
		'history'  => 'Done',
		'profile'  => 'Details',
	), $tab );

	if ( 'requests' === $tab ) {
		$out .= d4u_ph_requests( $reqs );
	} elseif ( 'history' === $tab ) {
		$done = d4u_orders_for( '_d4u_pharmacy', $uid, array( 'completed', 'cancelled' ), 30, 'DESC' );
		$out .= '<h3 class="d4u-h">Delivered and cancelled</h3>';
		$out .= $done ? '' : '<p class="d4u-empty">Nothing yet.</p>';
		foreach ( $done as $o ) {
			$out .= '<div class="d4u-row"><span>#' . esc_html( $o->get_order_number() ) . ' · ' . esc_html( $o->get_billing_first_name() ) . '</span><span>' . esc_html( wc_get_order_status_name( $o->get_status() ) ) . ' · ' . wp_kses_post( wc_price( $o->get_total() ) ) . '</span></div>';
		}
	} elseif ( 'profile' === $tab && ! $boss ) {
		$out .= d4u_ph_profile_form( $uid );
	} else {
		$out .= '<h3 class="d4u-h">Check prescription</h3>';
		$out .= $rx ? '' : '<p class="d4u-empty">No prescriptions to check.</p>';
		foreach ( $rx as $o ) {
			$out .= d4u_ph_card( $o, 'rx' );
		}
		$out .= '<h3 class="d4u-h">To pack</h3>';
		$out .= $pack ? '' : '<p class="d4u-empty">Nothing to pack right now.</p>';
		foreach ( $pack as $o ) {
			$out .= d4u_ph_card( $o, 'pack' );
		}
		if ( $waiting ) {
			$out .= '<h3 class="d4u-h">Packed — with the rider</h3>';
			foreach ( $waiting as $o ) {
				$rider = (int) $o->get_meta( '_d4u_rider' );
				$out  .= '<div class="d4u-row"><span>#' . esc_html( $o->get_order_number() ) . ' · ' . esc_html( $o->get_billing_first_name() ) . '</span><span>' . esc_html( wc_get_order_status_name( $o->get_status() ) ) . ( $rider ? ' · ' . esc_html( d4u_partner_name( $rider ) ) : ' · waiting for a rider' ) . '</span></div>';
			}
		}
	}
	return $out . '</div>' . d4u_refresh_script();
} );

function d4u_ph_card( $o, $mode ) {
	$out  = '<article class="d4u-card d4u-order">';
	$out .= '<header><strong>#' . esc_html( $o->get_order_number() ) . '</strong><span class="d4u-small">' . esc_html( d4u_ago( $o ) ) . '</span></header>';
	$out .= '<p>' . esc_html( trim( $o->get_billing_first_name() . ' ' . $o->get_billing_last_name() ) ) . ' · <a href="tel:' . esc_attr( preg_replace( '/[^0-9+]/', '', $o->get_billing_phone() ) ) . '">' . esc_html( $o->get_billing_phone() ) . '</a><br><span class="d4u-small">' . esc_html( d4u_order_address( $o ) ) . '</span></p>';
	if ( d4u_is_boss() ) {
		$ph   = (int) $o->get_meta( '_d4u_pharmacy' );
		$out .= '<p class="d4u-small">Pharmacy: ' . esc_html( $ph ? d4u_partner_name( $ph ) : 'none yet' ) . '</p>';
	}
	$out .= d4u_items_html( $o );
	$out .= '<p>' . d4u_pay_line( $o ) . '</p>';
	if ( $o->get_customer_note() ) {
		$out .= '<p class="d4u-note">“' . esc_html( $o->get_customer_note() ) . '”</p>';
	}
	if ( 'rx' === $mode ) {
		$out .= d4u_files_html( $o );
		if ( ! $o->get_meta( '_d4u_rx_files' ) ) {
			$out .= '<p class="d4u-flash d4u-flash--warn">No prescription file attached. Call the customer, or reject.</p>';
		}
		$out .= '<div class="d4u-actions">';
		$out .= d4u_action_btn( 'ph_rx', $o, 'Prescription OK — pack it', '', '<input type="hidden" name="decision" value="approve">' );
		$out .= '<details class="d4u-reject"><summary>Reject</summary>' . d4u_form_open( 'ph_rx' ) . '<input type="hidden" name="order" value="' . esc_attr( $o->get_id() ) . '"><input type="hidden" name="decision" value="reject"><label class="d4u-field"><span>Reason (the customer sees this)</span><input name="reason" required placeholder="e.g. prescription is older than 6 months"></label><button class="d4u-btn d4u-btn--danger" type="submit">Reject and cancel order</button></form></details>';
		$out .= d4u_pass_html( $o ) . '</div>';
	} else {
		$out .= '<div class="d4u-actions">' . d4u_form_open( 'ph_packed', 'd4u-pack-form' ) . '<input type="hidden" name="order" value="' . esc_attr( $o->get_id() ) . '"><label class="d4u-field"><span>Your bill no. (optional)</span><input name="bill" maxlength="40" autocomplete="off" placeholder="e.g. from Marg"></label><button class="d4u-btn" type="submit">Packed — ready for pickup</button></form>' . ( 'approved' === $o->get_meta( '_d4u_rx_state' ) ? '' : d4u_pass_html( $o ) ) . '</div>';
	}
	return $out . '</article>';
}

/** "Don't have it" — hand the order to the next pharmacy near the customer. */
function d4u_pass_html( $o ) {
	if ( d4u_is_boss() ) {
		return '';
	}
	$left = count( d4u_rank_pharmacies( d4u_order_pin( $o ), d4u_order_need( $o ), array_merge( d4u_passed( $o ), array( get_current_user_id() ) ) ) );
	$out  = '<details class="d4u-reject d4u-pass"><summary>Don’t have it</summary>' . d4u_form_open( 'ph_pass' ) . '<input type="hidden" name="order" value="' . esc_attr( $o->get_id() ) . '">';
	$out .= '<p class="d4u-small">' . ( $left ? esc_html( sprintf( 'We send it to the next pharmacy near the customer (%d more deliver%s to PIN %s). You won’t see this order again.', $left, 1 === $left ? 's' : '', d4u_order_pin( $o ) ) ) : esc_html( 'No other pharmacy delivers to PIN ' . d4u_order_pin( $o ) . ' — the dawa4u team will take over this order.' ) ) . '</p>';
	$out .= '<label class="d4u-field"><span>What’s missing? (optional)</span><input name="reason" maxlength="200" placeholder="e.g. Amoxicillin 500 out of stock"></label><button class="d4u-btn d4u-btn--ghost" type="submit">' . ( $left ? 'Send to another pharmacy' : 'Give to the dawa4u team' ) . '</button></form></details>';
	return $out;
}

function d4u_product_options() {
	static $html = null;
	if ( null !== $html ) {
		return $html;
	}
	$html = '<option value="">Choose medicine…</option>';
	foreach ( get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => true, 'orderby' => 'meta_value_num', 'meta_key' => 'order' ) ) as $term ) { // phpcs:ignore
		$prods = wc_get_products( array( 'status' => 'publish', 'limit' => 300, 'category' => array( $term->slug ), 'orderby' => 'title', 'order' => 'ASC' ) );
		if ( ! $prods ) {
			continue;
		}
		$html .= '<optgroup label="' . esc_attr( $term->name ) . '">';
		foreach ( $prods as $p ) {
			if ( d4u_is_pass_product( $p->get_id() ) ) {
				continue;
			}
			$html .= '<option value="' . esc_attr( $p->get_id() ) . '">' . esc_html( $p->get_name() . ' — ' . wp_strip_all_tags( wc_price( $p->get_price() ) ) ) . '</option>';
		}
		$html .= '</optgroup>';
	}
	return $html;
}

function d4u_ph_requests( $reqs ) {
	$out = '<h3 class="d4u-h">Prescriptions sent by customers</h3><p class="d4u-small">Read the prescription, add the medicines, and send it. The customer gets an email with the price and pays; then the order comes to “To pack”.</p>';
	if ( ! $reqs ) {
		return $out . '<p class="d4u-empty">No prescriptions waiting.</p>';
	}
	foreach ( $reqs as $o ) {
		$out .= d4u_ph_request_card( $o );
	}
	return $out;
}

/** One prescription the customer sent on its own: the pharmacist adds the medicines, or rejects it. */
function d4u_ph_request_card( $o ) {
	$out  = '<article class="d4u-card d4u-order">';
	$out .= '<header><strong>#' . esc_html( $o->get_order_number() ) . '</strong><span class="d4u-small">' . esc_html( d4u_ago( $o ) ) . '</span></header>';
	$out .= '<p>' . esc_html( $o->get_billing_first_name() ) . ' · <a href="tel:' . esc_attr( preg_replace( '/[^0-9+]/', '', $o->get_billing_phone() ) ) . '">' . esc_html( $o->get_billing_phone() ) . '</a><br><span class="d4u-small">' . esc_html( d4u_order_address( $o ) ) . '</span></p>';
	if ( d4u_is_boss() ) {
		$ph   = (int) $o->get_meta( '_d4u_pharmacy' );
		$out .= '<p class="d4u-small">Pharmacy: ' . esc_html( $ph ? d4u_partner_name( $ph ) : 'none yet' ) . '</p>';
	}
	if ( $o->get_customer_note() ) {
		$out .= '<p class="d4u-note">“' . esc_html( $o->get_customer_note() ) . '”</p>';
	}
	$out .= d4u_files_html( $o );
	$out .= d4u_form_open( 'ph_fill', 'd4u-fill' ) . '<input type="hidden" name="order" value="' . esc_attr( $o->get_id() ) . '">';
	for ( $i = 0; $i < 6; $i++ ) {
		$out .= '<div class="d4u-fill-row"><select name="pid[]">' . d4u_product_options() . '</select><input type="number" name="qty[]" min="1" max="20" value="1" aria-label="Quantity"></div>';
	}
	$out .= '<p class="d4u-small">Delivery, handling and any dawaPass discount are added automatically.</p>';
	$out .= '<button class="d4u-btn" type="submit" name="decision" value="send">Send to customer for payment</button></form>';
	$out .= '<details class="d4u-reject"><summary>Can’t fill it</summary>' . d4u_form_open( 'ph_fill' ) . '<input type="hidden" name="order" value="' . esc_attr( $o->get_id() ) . '"><input type="hidden" name="decision" value="reject"><label class="d4u-field"><span>Reason (the customer sees this)</span><input name="reason" required placeholder="e.g. the photo is not readable — please send it again"></label><button class="d4u-btn d4u-btn--danger" type="submit">Reject</button></form></details>';
	$out .= '<div class="d4u-actions">' . d4u_pass_html( $o ) . '</div>';
	return $out . '</article>';
}

/** The pharmacy's own details (shop name, phone, address, PIN codes). */
function d4u_ph_profile_form( $uid ) {
	$out  = d4u_form_open( 'ph_profile', 'd4u-card' );
	$out .= '<label class="d4u-field"><span>Pharmacy name</span><input name="shop" required value="' . esc_attr( get_user_meta( $uid, 'd4u_shop', true ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>Mobile number</span><input name="phone" required inputmode="numeric" value="' . esc_attr( get_user_meta( $uid, 'd4u_phone', true ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>Address</span><textarea name="address" rows="2" required>' . esc_textarea( get_user_meta( $uid, 'd4u_address', true ) ) . '</textarea></label>';
	$out .= '<label class="d4u-field"><span>City / town / village</span><input name="city" required value="' . esc_attr( get_user_meta( $uid, 'd4u_city', true ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>PIN codes you deliver to (comma-separated)</span><input name="pins" required inputmode="numeric" placeholder="e.g. 452001, 452002" value="' . esc_attr( implode( ', ', d4u_pins( $uid ) ) ) . '"></label>';
	$lic  = get_user_meta( $uid, 'd4u_licence', true );
	$out .= '<p class="d4u-small">Drug licence: ' . esc_html( $lic ? $lic : 'not added yet' ) . ' · To add or change it, write to the dawa4u team.</p>';
	return $out . '<button class="d4u-btn" type="submit">Save details</button></form>';
}

/* ------------------------------------------------------------------ pharmacy actions */

function d4u_do_ph_open() {
	$uid = get_current_user_id();
	if ( ! d4u_is_pharmacy( $uid ) || 'approved' !== d4u_status( $uid ) ) {
		d4u_back( 'Your account is not approved yet.', 'error' );
	}
	$open = 'yes' === get_user_meta( $uid, 'd4u_open', true );
	update_user_meta( $uid, 'd4u_open', $open ? 'no' : 'yes' );
	d4u_back( $open ? 'You are now closed.' : 'You are open. New orders will come here.', 'ok' );
}

function d4u_do_ph_profile() {
	$uid = get_current_user_id();
	if ( ! d4u_is_pharmacy( $uid ) ) {
		d4u_back( 'Not allowed.', 'error' );
	}
	$p     = wp_unslash( $_POST ); // phpcs:ignore
	$pins  = d4u_parse_pins( isset( $p['pins'] ) ? $p['pins'] : '' );
	$phone = d4u_clean_phone( isset( $p['phone'] ) ? $p['phone'] : '' );
	if ( ! $pins || ! preg_match( '/^[6-9]\d{9}$/', $phone ) ) {
		d4u_fail( array( 'Add at least one 6-digit PIN code and a 10-digit mobile number.' ) );
	}
	update_user_meta( $uid, 'd4u_shop', sanitize_text_field( isset( $p['shop'] ) ? $p['shop'] : '' ) );
	update_user_meta( $uid, 'd4u_phone', $phone );
	update_user_meta( $uid, 'd4u_address', sanitize_textarea_field( isset( $p['address'] ) ? $p['address'] : '' ) );
	update_user_meta( $uid, 'd4u_city', sanitize_text_field( isset( $p['city'] ) ? $p['city'] : '' ) );
	update_user_meta( $uid, 'd4u_pins', $pins );
	d4u_back( 'Saved.', 'ok' );
}

function d4u_do_ph_rx() {
	$order    = d4u_acting_order( '_d4u_pharmacy', array( 'd4u-rx' ) );
	$decision = isset( $_POST['decision'] ) ? sanitize_key( $_POST['decision'] ) : ''; // phpcs:ignore
	$who      = d4u_partner_name( get_current_user_id() );
	if ( 'approve' === $decision ) {
		d4u_ph_approve( $order, get_current_user_id() );
		d4u_back( 'Approved. Order #' . $order->get_order_number() . ' is now in “To pack”.', 'ok' );
	}
	$reason = sanitize_text_field( isset( $_POST['reason'] ) ? wp_unslash( $_POST['reason'] ) : '' ); // phpcs:ignore
	d4u_reject_order( $order, $reason ? $reason : 'The prescription could not be accepted.', $who );
	d4u_back( 'Order #' . $order->get_order_number() . ' was cancelled and the customer was told why.', 'ok' );
}

function d4u_reject_order( $order, $reason, $who ) {
	$order->update_meta_data( '_d4u_rx_state', 'rejected' );
	$order->update_meta_data( '_d4u_rx_reason', $reason );
	$order->update_meta_data( '_d4u_rx_by', get_current_user_id() );
	$order->save();
	$paid_online = $order->get_date_paid() && 'cod' !== $order->get_payment_method();
	$order->update_status( 'cancelled', 'Prescription not accepted by ' . $who . ': ' . $reason );
	$html = '<p>We’re sorry — the pharmacist could not accept your prescription for order #' . esc_html( $order->get_order_number() ) . '.</p><p><strong>Reason:</strong> ' . esc_html( $reason ) . '</p>';
	if ( $paid_online ) {
		$html .= '<p>Your payment of ' . wp_kses_post( wc_price( $order->get_total() ) ) . ' will be refunded to your original payment method in 3–5 working days.</p>';
		$order->add_order_note( 'REFUND DUE: ' . wp_strip_all_tags( wc_price( $order->get_total() ) ) . ' — paid online, order cancelled.' );
		d4u_mail( get_option( 'admin_email' ), 'Refund due — order #' . $order->get_order_number(), 'Refund due', '<p>Order #' . esc_html( $order->get_order_number() ) . ' was paid online and then cancelled (prescription not accepted). Please refund ' . wp_kses_post( wc_price( $order->get_total() ) ) . '.</p><p><a href="' . esc_url( $order->get_edit_order_url() ) . '">Open the order</a></p>' );
	}
	$html .= '<p>You can send a new prescription any time from <a href="' . esc_url( d4u_page_url( 'rx' ) ) . '">Upload prescription</a>.</p>';
	d4u_mail( $order->get_billing_email(), 'About your order #' . $order->get_order_number(), 'Prescription not accepted', $html );
}

function d4u_do_ph_packed() {
	$order = d4u_acting_order( '_d4u_pharmacy', array( 'processing' ) );
	$bill  = isset( $_POST['bill'] ) ? sanitize_text_field( wp_unslash( $_POST['bill'] ) ) : ''; // phpcs:ignore
	d4u_ph_packed( $order, get_current_user_id(), $bill );
	d4u_back( 'Order #' . $order->get_order_number() . ' is ready for pickup. Nearby riders were told.', 'ok' );
}

/** Prescription approved: the order goes to packing. Used by the dashboard and the API. */
function d4u_ph_approve( $order, $uid ) {
	$order->update_meta_data( '_d4u_rx_state', 'approved' );
	$order->update_meta_data( '_d4u_rx_by', (int) $uid );
	$order->save();
	$order->update_status( 'processing', 'Prescription approved by ' . d4u_partner_name( $uid ) . '.' );
}

/** Packed: riders nearby are told. $bill = the pharmacy's own bill number (e.g. from Marg), optional. */
function d4u_ph_packed( $order, $uid, $bill = '' ) {
	$bill = substr( trim( (string) $bill ), 0, 40 );
	if ( '' !== $bill ) {
		$order->update_meta_data( '_d4u_bill_no', $bill );
		$order->save();
	}
	$order->update_status( 'd4u-ready', 'Packed by ' . d4u_partner_name( $uid ) . ( '' !== $bill ? ' (bill ' . $bill . ')' : '' ) . '.' );
}

/** Pharmacies that said they don't have an order's medicines. */
function d4u_passed( $order ) {
	$p = $order->get_meta( '_d4u_passed' );
	return is_array( $p ) ? array_map( 'intval', $p ) : array();
}

/**
 * A pharmacy doesn't have the medicines: try the next pharmacy near the customer,
 * and if every one has said no, the dawa4u team takes over.
 *
 * @return int the new pharmacy, 0 if none was left
 */
function d4u_ph_pass( $order, $uid, $reason = '' ) {
	$passed   = array_values( array_unique( array_merge( d4u_passed( $order ), array( (int) $uid ) ) ) );
	$reason   = substr( trim( (string) $reason ), 0, 200 );
	$list     = d4u_rank_pharmacies( d4u_order_pin( $order ), d4u_order_need( $order ), $passed );
	$next     = $list ? (int) $list[0]['id'] : 0;
	$order->update_meta_data( '_d4u_passed', $passed );
	$order->add_order_note( d4u_partner_name( $uid ) . ' doesn’t have it' . ( '' !== $reason ? ' (' . $reason . ')' : '' ) . '. ' . ( $next ? 'Sent to ' . d4u_partner_name( $next ) . ' — ' . d4u_stock_words( $list[0]['stock'] ) . '.' : 'No other pharmacy left for PIN ' . d4u_order_pin( $order ) . '.' ) );
	if ( $next ) {
		$order->update_meta_data( '_d4u_pharmacy', $next );
		$order->save();
		d4u_mail_pharmacy_once( $order );
		if ( function_exists( 'd4u_hook_send' ) && get_user_meta( $next, 'd4u_hook_url', true ) ) {
			d4u_hook_send( $next, 'order.' . d4u_api_status( $order->get_status() ), $order );
		}
		return $next;
	}
	$order->delete_meta_data( '_d4u_pharmacy' );
	$order->save();
	d4u_mail(
		get_option( 'admin_email' ),
		'No pharmacy has order #' . $order->get_order_number(),
		'Every pharmacy said no',
		'<p>All ' . count( $passed ) . ' pharmac' . ( 1 === count( $passed ) ? 'y' : 'ies' ) . ' for PIN ' . esc_html( d4u_order_pin( $order ) ) . ' said they don’t have the medicines for order #' . esc_html( $order->get_order_number() ) . ( '' !== $reason ? ' (last note: ' . esc_html( $reason ) . ')' : '' ) . '.</p><p>Find a pharmacy for it, or call the customer and cancel (and refund if they paid online).</p><p><a href="' . esc_url( $order->get_edit_order_url() ) . '">Open the order</a></p>'
	);
	return 0;
}

function d4u_do_ph_pass() {
	$order = d4u_acting_order( '_d4u_pharmacy', array( 'd4u-rx', 'processing', 'd4u-request' ) );
	if ( d4u_is_boss() ) {
		d4u_back( 'Choose the pharmacy in the order screen instead.', 'error' );
	}
	if ( $order->has_status( 'processing' ) && 'approved' === $order->get_meta( '_d4u_rx_state' ) ) {
		d4u_back( 'You already approved this prescription, so this order stays with you. Call the dawa4u team if you can’t pack it.', 'error' );
	}
	$reason = isset( $_POST['reason'] ) ? sanitize_text_field( wp_unslash( $_POST['reason'] ) ) : ''; // phpcs:ignore
	$next   = d4u_ph_pass( $order, get_current_user_id(), $reason );
	d4u_back( $next ? 'Thanks — order #' . $order->get_order_number() . ' went to another pharmacy near the customer.' : 'Thanks — no other pharmacy delivers there, so the dawa4u team will take over order #' . $order->get_order_number() . '.', 'ok' );
}

function d4u_do_ph_fill() {
	$order    = d4u_acting_order( '_d4u_pharmacy', array( 'd4u-request' ) );
	$decision = isset( $_POST['decision'] ) ? sanitize_key( $_POST['decision'] ) : ''; // phpcs:ignore
	$who      = d4u_partner_name( get_current_user_id() );
	if ( 'reject' === $decision ) {
		$reason = sanitize_text_field( isset( $_POST['reason'] ) ? wp_unslash( $_POST['reason'] ) : '' ); // phpcs:ignore
		d4u_reject_order( $order, $reason ? $reason : 'The prescription could not be filled.', $who );
		d4u_back( 'Rejected. The customer was told why.', 'ok' );
	}
	$pids  = isset( $_POST['pid'] ) ? array_map( 'absint', (array) $_POST['pid'] ) : array(); // phpcs:ignore
	$qtys  = isset( $_POST['qty'] ) ? array_map( 'absint', (array) $_POST['qty'] ) : array(); // phpcs:ignore
	$lines = array();
	foreach ( $pids as $i => $pid ) {
		if ( ! $pid || d4u_is_pass_product( $pid ) ) {
			continue;
		}
		$q             = isset( $qtys[ $i ] ) ? min( 20, max( 1, $qtys[ $i ] ) ) : 1;
		$lines[ $pid ] = ( isset( $lines[ $pid ] ) ? $lines[ $pid ] : 0 ) + $q;
	}
	if ( ! $lines ) {
		d4u_fail( array( 'Choose at least one medicine.' ) );
	}
	foreach ( $lines as $pid => $q ) {
		$p = wc_get_product( $pid );
		if ( $p && $p->is_purchasable() ) {
			$order->add_product( $p, $q );
		}
	}
	d4u_order_add_charges( $order );
	$order->update_meta_data( '_d4u_rx_state', 'approved' );
	$order->update_meta_data( '_d4u_rx_by', get_current_user_id() );
	$order->save();
	$order->update_status( 'pending', 'Medicines added by ' . $who . '. Waiting for the customer to pay.' );
	$emails = WC()->mailer()->get_emails();
	if ( isset( $emails['WC_Email_Customer_Invoice'] ) ) {
		$emails['WC_Email_Customer_Invoice']->trigger( $order->get_id(), $order );
	}
	d4u_back( 'Sent. The customer got an email to pay ' . wp_strip_all_tags( wc_price( $order->get_total() ) ) . '.', 'ok' );
}

/* ------------------------------------------------------------------ rider dashboard */

add_shortcode( 'dawa4u_rider', function () {
	list( $ok, $out ) = d4u_gate( 'd4u_rider', 'rider' );
	if ( ! $ok ) {
		return '<div class="d4u-dash">' . $out . '</div>';
	}
	$uid    = get_current_user_id();
	$boss   = d4u_is_boss( $uid );
	$online = $boss || 'yes' === get_user_meta( $uid, 'd4u_online', true );
	$tab    = isset( $_GET['tab'] ) ? sanitize_key( $_GET['tab'] ) : 'now'; // phpcs:ignore

	$out .= '<div class="d4u-dash">';
	if ( ! $boss ) {
		$out .= '<div class="d4u-head d4u-card"><div><h2>' . esc_html( d4u_partner_name( $uid ) ) . '</h2><p class="d4u-small">Your PIN codes: ' . esc_html( implode( ', ', d4u_pins( $uid ) ) ) . '</p></div>';
		$out .= d4u_form_open( 'rd_online', 'd4u-inline' ) . '<button class="d4u-switch ' . ( $online ? 'is-on' : '' ) . '" type="submit">' . ( $online ? 'Online — getting deliveries' : 'Offline — tap to go online' ) . '</button></form></div>';
	}
	$out .= d4u_tabs( array( 'now' => 'Deliveries', 'pay' => 'Earnings', 'profile' => 'Details' ), $tab );

	if ( 'pay' === $tab ) {
		$out .= d4u_rider_earnings( $uid );
	} elseif ( 'profile' === $tab && ! $boss ) {
		$v    = get_user_meta( $uid, 'd4u_vehicle', true );
		$out .= d4u_form_open( 'rd_profile', 'd4u-card' );
		$out .= '<label class="d4u-field"><span>Mobile number</span><input name="phone" required value="' . esc_attr( get_user_meta( $uid, 'd4u_phone', true ) ) . '"></label>';
		$out .= '<label class="d4u-field"><span>Vehicle</span><select name="vehicle">';
		foreach ( array( 'bike' => 'Motorbike', 'scooter' => 'Scooter', 'ev' => 'Electric scooter', 'cycle' => 'Bicycle' ) as $k => $l ) {
			$out .= '<option value="' . esc_attr( $k ) . '"' . selected( $v, $k, false ) . '>' . esc_html( $l ) . '</option>';
		}
		$out .= '</select></label>';
		$out .= '<label class="d4u-field"><span>PIN codes where you deliver</span><input name="pins" required value="' . esc_attr( implode( ', ', d4u_pins( $uid ) ) ) . '"></label>';
		$out .= '<button class="d4u-btn" type="submit">Save</button></form>';
	} else {
		$mine = d4u_orders_for( '_d4u_rider', $uid, array( 'd4u-ready', 'd4u-out' ) );
		if ( $boss ) {
			$mine = array_filter( $mine, function ( $o ) {
				return (bool) $o->get_meta( '_d4u_rider' );
			} );
		}
		$out .= '<h3 class="d4u-h">' . ( $boss ? 'Deliveries with a rider' : 'Your deliveries' ) . '</h3>';
		$out .= $mine ? '' : '<p class="d4u-empty">' . ( $online ? 'No deliveries yet. Take one below when it appears.' : 'Go online to get deliveries.' ) . '</p>';
		foreach ( $mine as $o ) {
			$out .= d4u_rider_card( $o, 'mine' );
		}
		if ( $online ) {
			$pins  = d4u_pins( $uid );
			$ready = array_filter( wc_get_orders( array( 'status' => array( 'd4u-ready' ), 'limit' => 60, 'orderby' => 'date', 'order' => 'ASC' ) ), function ( $o ) use ( $pins, $boss ) {
				return ! $o->get_meta( '_d4u_rider' ) && ( $boss || in_array( d4u_order_pin( $o ), $pins, true ) );
			} );
			$out .= '<h3 class="d4u-h">Ready for pickup near you</h3>';
			$out .= $ready ? '' : '<p class="d4u-empty">Nothing waiting right now. This page checks again every minute.</p>';
			foreach ( $ready as $o ) {
				$out .= d4u_rider_card( $o, 'open' );
			}
		}
	}
	return $out . '</div>' . d4u_refresh_script();
} );

function d4u_rider_card( $o, $mode ) {
	$ph    = (int) $o->get_meta( '_d4u_pharmacy' );
	$from  = $ph ? trim( get_user_meta( $ph, 'd4u_address', true ) . ', ' . get_user_meta( $ph, 'd4u_city', true ), ', ' ) : '';
	$to    = d4u_order_address( $o );
	$out   = '<article class="d4u-card d4u-order">';
	$out  .= '<header><strong>#' . esc_html( $o->get_order_number() ) . '</strong><span class="d4u-small">' . esc_html( wc_get_order_status_name( $o->get_status() ) ) . '</span></header>';
	$out  .= '<div class="d4u-route">';
	$out  .= '<p><span class="d4u-dot">Pick up</span><strong>' . esc_html( $ph ? d4u_partner_name( $ph ) : 'Pharmacy not set' ) . '</strong><br><span class="d4u-small">' . esc_html( $from ) . '</span>';
	if ( $ph && 'mine' === $mode ) {
		$out .= '<br><a href="tel:' . esc_attr( get_user_meta( $ph, 'd4u_phone', true ) ) . '">Call pharmacy</a> · <a href="' . esc_url( d4u_maps_link( d4u_partner_name( $ph ) . ', ' . $from ) ) . '" target="_blank" rel="noopener">Map</a>';
	}
	$out .= '</p>';
	if ( 'mine' === $mode ) {
		$out .= '<p><span class="d4u-dot d4u-dot--to">Deliver to</span><strong>' . esc_html( trim( $o->get_billing_first_name() . ' ' . $o->get_billing_last_name() ) ) . '</strong><br><span class="d4u-small">' . esc_html( $to ) . '</span><br><a href="tel:' . esc_attr( preg_replace( '/[^0-9+]/', '', $o->get_billing_phone() ) ) . '">Call customer</a> · <a href="' . esc_url( d4u_maps_link( $to ) ) . '" target="_blank" rel="noopener">Map</a></p>';
	} else {
		$out .= '<p><span class="d4u-dot d4u-dot--to">Deliver to</span>PIN ' . esc_html( d4u_order_pin( $o ) ) . ' · ' . esc_html( $o->get_shipping_city() ? $o->get_shipping_city() : $o->get_billing_city() ) . '</p>';
	}
	$out .= '</div>';
	$out .= '<p>' . d4u_pay_line( $o ) . ' <span class="d4u-pill">You earn ' . esc_html( d4u_inr( d4u_opt( 'rider_pay' ) ) ) . '</span></p>';
	if ( 'mine' === $mode && $o->get_customer_note() ) {
		$out .= '<p class="d4u-note">“' . esc_html( $o->get_customer_note() ) . '”</p>';
	}
	$out .= '<div class="d4u-actions">';
	if ( 'open' === $mode ) {
		$out .= d4u_action_btn( 'rd_take', $o, 'Take this delivery' );
	} elseif ( $o->has_status( 'd4u-ready' ) ) {
		$out .= d4u_action_btn( 'rd_picked', $o, 'Picked up — start delivery' );
	} else {
		$out .= d4u_form_open( 'rd_delivered', 'd4u-code-form' ) . '<input type="hidden" name="order" value="' . esc_attr( $o->get_id() ) . '"><label class="d4u-field"><span>Code from the customer</span><input name="code" required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off"></label><button class="d4u-btn" type="submit">Delivered</button></form>';
	}
	$out .= '</div></article>';
	return $out;
}

function d4u_rider_earnings( $uid ) {
	$done  = d4u_orders_for( '_d4u_rider', $uid, array( 'completed' ), 300, 'DESC' );
	$week  = 0;
	$today = 0;
	$all   = 0;
	$cash  = 0;
	$t0    = strtotime( 'today', current_time( 'timestamp' ) ) - ( (int) get_option( 'gmt_offset' ) * HOUR_IN_SECONDS ); // phpcs:ignore
	foreach ( $done as $o ) {
		$pay = (float) $o->get_meta( '_d4u_rider_pay' );
		$at  = (int) $o->get_meta( '_d4u_delivered_at' );
		$all += $pay;
		if ( $at > time() - 7 * DAY_IN_SECONDS ) {
			$week += $pay;
		}
		if ( $at >= $t0 ) {
			$today += $pay;
			if ( 'cod' === $o->get_payment_method() ) {
				$cash += (float) $o->get_total();
			}
		}
	}
	$out  = '<div class="d4u-stats">';
	$out .= '<div class="d4u-card"><span>Today</span><strong>' . esc_html( d4u_inr( $today ) ) . '</strong></div>';
	$out .= '<div class="d4u-card"><span>Last 7 days</span><strong>' . esc_html( d4u_inr( $week ) ) . '</strong></div>';
	$out .= '<div class="d4u-card"><span>Cash collected today</span><strong>' . esc_html( d4u_inr( $cash ) ) . '</strong></div>';
	$out .= '</div><p class="d4u-small">' . count( $done ) . ' deliveries in total · ' . esc_html( d4u_inr( $all ) ) . ' earned. Hand the cash you collect to the dawa4u team as agreed.</p>';
	foreach ( array_slice( $done, 0, 20 ) as $o ) {
		$at   = (int) $o->get_meta( '_d4u_delivered_at' );
		$out .= '<div class="d4u-row"><span>#' . esc_html( $o->get_order_number() ) . ' · ' . esc_html( $at ? date_i18n( 'j M, g:i a', $at + (int) get_option( 'gmt_offset' ) * HOUR_IN_SECONDS ) : '' ) . '</span><span>' . esc_html( d4u_inr( $o->get_meta( '_d4u_rider_pay' ) ) ) . '</span></div>';
	}
	return $out;
}

/* ------------------------------------------------------------------ rider actions */

function d4u_do_rd_online() {
	$uid = get_current_user_id();
	if ( ! d4u_is_rider( $uid ) || 'approved' !== d4u_status( $uid ) ) {
		d4u_back( 'Your account is not approved yet.', 'error' );
	}
	$on = 'yes' === get_user_meta( $uid, 'd4u_online', true );
	update_user_meta( $uid, 'd4u_online', $on ? 'no' : 'yes' );
	d4u_back( $on ? 'You are offline.' : 'You are online. New deliveries near you will show here.', 'ok' );
}

function d4u_do_rd_profile() {
	$uid = get_current_user_id();
	if ( ! d4u_is_rider( $uid ) ) {
		d4u_back( 'Not allowed.', 'error' );
	}
	$p     = wp_unslash( $_POST ); // phpcs:ignore
	$pins  = d4u_parse_pins( isset( $p['pins'] ) ? $p['pins'] : '' );
	$phone = d4u_clean_phone( isset( $p['phone'] ) ? $p['phone'] : '' );
	$veh   = sanitize_key( isset( $p['vehicle'] ) ? $p['vehicle'] : '' );
	if ( ! $pins || ! preg_match( '/^[6-9]\d{9}$/', $phone ) ) {
		d4u_fail( array( 'Add at least one 6-digit PIN code and a 10-digit mobile number.' ) );
	}
	update_user_meta( $uid, 'd4u_phone', $phone );
	update_user_meta( $uid, 'd4u_pins', $pins );
	if ( in_array( $veh, array( 'bike', 'scooter', 'ev', 'cycle' ), true ) ) {
		update_user_meta( $uid, 'd4u_vehicle', $veh );
	}
	d4u_back( 'Saved.', 'ok' );
}

function d4u_do_rd_take() {
	$uid   = get_current_user_id();
	$order = d4u_acting_order( '', array( 'd4u-ready' ) );
	if ( ! d4u_is_boss( $uid ) && ( ! d4u_is_rider( $uid ) || 'yes' !== get_user_meta( $uid, 'd4u_online', true ) ) ) {
		d4u_back( 'Go online first.', 'error' );
	}
	if ( $order->get_meta( '_d4u_rider' ) ) {
		d4u_back( 'Another rider already took order #' . $order->get_order_number() . '.', 'error' );
	}
	if ( ! d4u_is_boss( $uid ) && ! in_array( d4u_order_pin( $order ), d4u_pins( $uid ), true ) ) {
		d4u_back( 'This delivery is outside your PIN codes.', 'error' );
	}
	$order->update_meta_data( '_d4u_rider', $uid );
	$order->add_order_note( 'Rider: ' . d4u_partner_name( $uid ) . '.' );
	$order->save();
	d4u_back( 'Order #' . $order->get_order_number() . ' is yours. Go to the pharmacy to pick it up.', 'ok' );
}

function d4u_do_rd_picked() {
	$order = d4u_acting_order( '_d4u_rider', array( 'd4u-ready' ) );
	if ( ! $order->get_meta( '_d4u_rider' ) ) {
		$order->update_meta_data( '_d4u_rider', get_current_user_id() );
		$order->save();
	}
	$order->update_status( 'd4u-out', 'Picked up by ' . d4u_partner_name( (int) $order->get_meta( '_d4u_rider' ) ) . '.' );
	d4u_back( 'On the way! Ask the customer for their 4-digit code when you arrive.', 'ok' );
}

function d4u_do_rd_delivered() {
	$order = d4u_acting_order( '_d4u_rider', array( 'd4u-out' ) );
	$code  = preg_replace( '/\D/', '', isset( $_POST['code'] ) ? sanitize_text_field( wp_unslash( $_POST['code'] ) ) : '' ); // phpcs:ignore
	if ( ! $code || ! hash_equals( (string) $order->get_meta( '_d4u_code' ), $code ) ) {
		d4u_back( 'That code is not right. Ask the customer to check the code in their order or email.', 'error' );
	}
	$rider = (int) $order->get_meta( '_d4u_rider' );
	$order->update_meta_data( '_d4u_rider_pay', (float) d4u_opt( 'rider_pay' ) );
	$order->update_meta_data( '_d4u_delivered_at', time() );
	if ( ! $order->get_date_paid() ) {
		$order->set_date_paid( time() );
	}
	$order->save();
	$order->update_status( 'completed', 'Delivered by ' . d4u_partner_name( $rider ) . ( 'cod' === $order->get_payment_method() ? ' — cash collected.' : '.' ) );
	d4u_back( 'Delivered! ' . d4u_inr( d4u_opt( 'rider_pay' ) ) . ' added to your earnings.', 'ok' );
}
