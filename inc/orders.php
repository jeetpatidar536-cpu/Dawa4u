<?php
/**
 * Order statuses for the dawa4u flow, emails at each step, dawaPass activation,
 * the "dawa4u" box on the order screen, and the tracking box customers see.
 *
 * Flow:  Prescription request → (pharmacist adds medicines, customer pays) →
 *        Prescription check → Processing (packing) → Ready for pickup → Out for delivery → Completed
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function d4u_statuses() {
	return array(
		'd4u-request' => 'Prescription request',
		'd4u-rx'      => 'Prescription check',
		'd4u-ready'   => 'Ready for pickup',
		'd4u-out'     => 'Out for delivery',
	);
}

add_action( 'init', function () {
	foreach ( d4u_statuses() as $key => $label ) {
		register_post_status( 'wc-' . $key, array(
			'label'                     => $label,
			'public'                    => false,
			'exclude_from_search'       => false,
			'show_in_admin_all_list'    => true,
			'show_in_admin_status_list' => true,
			/* translators: %s: number of orders */
			'label_count'               => _n_noop( $label . ' <span class="count">(%s)</span>', $label . ' <span class="count">(%s)</span>' ), // phpcs:ignore
		) );
	}
} );

add_filter( 'wc_order_statuses', function ( $s ) {
	$d   = d4u_statuses();
	$out = array();
	foreach ( $s as $k => $v ) {
		if ( 'wc-processing' === $k ) {
			$out['wc-d4u-request'] = $d['d4u-request'];
			$out['wc-d4u-rx']      = $d['d4u-rx'];
		}
		$out[ $k ] = $v;
		if ( 'wc-processing' === $k ) {
			$out['wc-d4u-ready'] = $d['d4u-ready'];
			$out['wc-d4u-out']   = $d['d4u-out'];
		}
	}
	return $out;
} );

add_filter( 'woocommerce_order_is_paid_statuses', function ( $s ) {
	return array_merge( (array) $s, array( 'd4u-ready', 'd4u-out' ) );
} );

add_filter( 'woocommerce_reports_order_statuses', function ( $s ) {
	return is_array( $s ) ? array_merge( $s, array( 'd4u-ready', 'd4u-out' ) ) : $s;
} );

add_filter( 'wc_order_is_editable', function ( $editable, $order ) {
	return $editable || $order->has_status( 'd4u-request' );
}, 10, 2 );

add_filter( 'woocommerce_valid_order_statuses_for_cancel', function ( $s ) {
	$s[] = 'd4u-request';
	return $s;
} );

/* ------------------------------------------------------------------ dawaPass */

function d4u_maybe_grant_pass( $order ) {
	if ( $order->get_meta( '_d4u_pass_given' ) || ! $order->get_customer_id() ) {
		return;
	}
	$qty = 0;
	foreach ( $order->get_items() as $item ) {
		if ( d4u_is_pass_product( $item->get_product_id() ) ) {
			$qty += max( 1, (int) $item->get_quantity() );
		}
	}
	if ( ! $qty ) {
		return;
	}
	$until = d4u_grant_pass( $order->get_customer_id(), $qty * (int) d4u_opt( 'pass_days' ) );
	$order->update_meta_data( '_d4u_pass_given', time() );
	$order->add_order_note( 'dawaPass active until ' . date_i18n( 'j M Y', $until ) . '.' );
	$order->save();
}

/* ------------------------------------------------------------------ emails at each step */

function d4u_order_link( $order ) {
	return '<p><a href="' . esc_url( $order->get_view_order_url() ) . '">See your order</a></p>';
}

function d4u_mail_customer( $order, $subject, $heading, $html ) {
	d4u_mail( $order->get_billing_email(), $subject, $heading, $html . d4u_order_link( $order ) );
}

function d4u_mail_pharmacy_once( $order ) {
	$ph = (int) $order->get_meta( '_d4u_pharmacy' );
	if ( ! $ph || (int) $order->get_meta( '_d4u_ph_mailed' ) === $ph ) {
		return;
	}
	$what = $order->has_status( 'd4u-request' ) ? 'A customer sent a prescription. Read it and add the medicines.' : ( $order->has_status( 'd4u-rx' ) ? 'New order — please check the prescription.' : 'New order — please pack it.' );
	d4u_mail(
		d4u_user_email( $ph ),
		'New dawa4u order #' . $order->get_order_number(),
		'New order #' . $order->get_order_number(),
		'<p>' . esc_html( $what ) . '</p><p>PIN ' . esc_html( d4u_order_pin( $order ) ) . ' · ' . wp_kses_post( wc_price( $order->get_total() ) ) . '</p><p><a href="' . esc_url( d4u_page_url( 'pharmacy' ) ) . '">Open the pharmacy dashboard</a></p>'
	);
	$order->update_meta_data( '_d4u_ph_mailed', $ph );
	$order->save();
}

function d4u_mail_riders( $order ) {
	$pin = d4u_order_pin( $order );
	foreach ( d4u_partners( 'd4u_rider' ) as $u ) {
		if ( 'yes' !== get_user_meta( $u->ID, 'd4u_online', true ) || ! in_array( $pin, d4u_pins( $u->ID ), true ) ) {
			continue;
		}
		d4u_mail(
			$u->user_email,
			'Delivery ready near you — #' . $order->get_order_number(),
			'Delivery ready for pickup',
			'<p>Pick up from ' . esc_html( d4u_partner_name( $order->get_meta( '_d4u_pharmacy' ) ) ) . ' and deliver to PIN ' . esc_html( $pin ) . '.</p><p><a href="' . esc_url( d4u_page_url( 'rider' ) ) . '">Open the rider dashboard to take it</a></p>'
		);
	}
}

add_action( 'woocommerce_order_status_changed', function ( $order_id, $from, $to, $order = null ) {
	if ( ! $order instanceof WC_Order ) {
		$order = wc_get_order( $order_id );
	}
	if ( ! $order ) {
		return;
	}

	// dawaPass starts once it is paid (cash orders: once delivered).
	$paid = in_array( $to, array( 'processing', 'completed', 'd4u-rx', 'd4u-ready', 'd4u-out' ), true );
	if ( $paid && ( 'cod' !== $order->get_payment_method() || 'completed' === $to ) ) {
		d4u_maybe_grant_pass( $order );
	}

	$no = $order->get_order_number();
	switch ( $to ) {
		case 'd4u-rx':
			d4u_mail_customer( $order, 'We got your order #' . $no, 'Your prescription is being checked',
				'<p>Thank you! A licensed pharmacist is checking your prescription now. As soon as it is approved, your order is packed and a rider brings it to you.</p>' );
			$emails = WC()->mailer()->get_emails();
			if ( isset( $emails['WC_Email_New_Order'] ) ) {
				$emails['WC_Email_New_Order']->trigger( $order->get_id(), $order );
			}
			d4u_mail_pharmacy_once( $order );
			break;
		case 'd4u-request':
			d4u_mail_customer( $order, 'We got your prescription', 'Your prescription is with a pharmacist',
				'<p>A licensed pharmacist will read it and add your medicines. We will email you the list and the price, and you pay only after that.</p>' );
			d4u_mail( get_option( 'admin_email' ), 'New prescription #' . $no, 'New prescription', '<p>A customer sent a prescription (PIN ' . esc_html( d4u_order_pin( $order ) ) . ').</p><p><a href="' . esc_url( $order->get_edit_order_url() ) . '">Open order #' . esc_html( $no ) . '</a></p>' );
			d4u_mail_pharmacy_once( $order );
			break;
		case 'processing':
			if ( 'd4u-rx' === $from ) {
				d4u_mail_customer( $order, 'Prescription approved — order #' . $no, 'Your prescription is approved',
					'<p>The pharmacist approved your prescription. Your medicines are being packed now.</p>' );
			}
			d4u_mail_pharmacy_once( $order );
			break;
		case 'd4u-ready':
			d4u_mail_riders( $order );
			break;
		case 'd4u-out':
			$rider = (int) $order->get_meta( '_d4u_rider' );
			$html  = '<p>Your medicines are on the way.</p>';
			if ( $rider ) {
				$html .= '<p>Rider: <strong>' . esc_html( d4u_partner_name( $rider ) ) . '</strong> · ' . esc_html( get_user_meta( $rider, 'd4u_phone', true ) ) . '</p>';
			}
			$html .= '<p>Share this code with the rider when your order arrives: <strong style="font-size:22px;letter-spacing:4px">' . esc_html( $order->get_meta( '_d4u_code' ) ) . '</strong></p>';
			if ( 'cod' === $order->get_payment_method() ) {
				$html .= '<p>Please keep ' . wp_kses_post( wc_price( $order->get_total() ) ) . ' ready to pay the rider.</p>';
			}
			d4u_mail_customer( $order, 'Out for delivery — order #' . $no, 'Your order is on the way', $html );
			break;
	}
}, 20, 4 );

/* ------------------------------------------------------------------ the "dawa4u" box on the order screen (wp-admin) */

add_action( 'add_meta_boxes', function () {
	$screen = 'shop_order';
	if ( function_exists( 'wc_get_page_screen_id' ) ) {
		$screen = wc_get_page_screen_id( 'shop-order' );
	}
	add_meta_box( 'd4u-order', 'dawa4u', 'd4u_order_box', $screen, 'side', 'high' );
	if ( 'shop_order' !== $screen ) {
		add_meta_box( 'd4u-order', 'dawa4u', 'd4u_order_box', 'shop_order', 'side', 'high' );
	}
} );

function d4u_order_box( $obj ) {
	$order = ( $obj instanceof WP_Post ) ? wc_get_order( $obj->ID ) : $obj;
	if ( ! $order instanceof WC_Order ) {
		return;
	}
	wp_nonce_field( 'd4u_order_box', 'd4u_order_box_nonce' );
	echo '<p><strong>Delivery code:</strong> ' . esc_html( $order->get_meta( '_d4u_code' ) ? $order->get_meta( '_d4u_code' ) : '—' ) . '</p>';

	$files = (array) $order->get_meta( '_d4u_rx_files' );
	$state = (string) $order->get_meta( '_d4u_rx_state' );
	if ( $files || $state || d4u_order_has_rx_items( $order ) ) {
		echo '<p><strong>Prescription</strong><br>';
		foreach ( array_values( array_filter( $files ) ) as $i => $f ) {
			echo '<a href="' . esc_url( d4u_rx_file_url( $order, $i ) ) . '" target="_blank" rel="noopener">' . esc_html( $f['name'] ? $f['name'] : 'File ' . ( $i + 1 ) ) . '</a><br>';
		}
		if ( ! $files ) {
			echo '<em>No file attached.</em><br>';
		}
		echo '</p><p><label>Status<br><select name="d4u_rx_state" style="width:100%">';
		foreach ( array( '' => '—', 'pending' => 'Waiting for pharmacist', 'approved' => 'Approved', 'rejected' => 'Not accepted' ) as $k => $v ) {
			echo '<option value="' . esc_attr( $k ) . '"' . selected( $state, $k, false ) . '>' . esc_html( $v ) . '</option>';
		}
		echo '</select></label></p>';
		if ( $order->get_meta( '_d4u_rx_reason' ) ) {
			echo '<p><em>' . esc_html( $order->get_meta( '_d4u_rx_reason' ) ) . '</em></p>';
		}
	}

	$ph = (int) $order->get_meta( '_d4u_pharmacy' );
	echo '<p><label><strong>Pharmacy</strong><br><select name="d4u_pharmacy" style="width:100%"><option value="0">— none —</option>';
	foreach ( d4u_partners( 'd4u_pharmacy' ) as $u ) {
		echo '<option value="' . esc_attr( $u->ID ) . '"' . selected( $ph, $u->ID, false ) . '>' . esc_html( d4u_partner_name( $u->ID ) . ' (' . implode( ', ', array_slice( d4u_pins( $u->ID ), 0, 4 ) ) . ')' ) . '</option>';
	}
	echo '</select></label></p>';
	$need = d4u_order_need( $order );
	$rank = d4u_rank_pharmacies( d4u_order_pin( $order ), $need );
	$said = d4u_passed( $order );
	if ( $rank || $said ) {
		echo '<p class="description"><strong>Pharmacies for PIN ' . esc_html( d4u_order_pin( $order ) ) . ', best first:</strong><br>';
		foreach ( $rank as $r ) {
			echo esc_html( d4u_partner_name( $r['id'] ) . ' — ' . ( $r['open'] ? 'open' : 'closed' ) . ( $need ? ', ' . d4u_stock_words( $r['stock'] ) : '' ) . ( in_array( $r['id'], $said, true ) ? ' — said they don’t have it' : '' ) ) . '<br>';
		}
		echo '</p>';
	}

	$rd = (int) $order->get_meta( '_d4u_rider' );
	echo '<p><label><strong>Rider</strong><br><select name="d4u_rider" style="width:100%"><option value="0">— none —</option>';
	foreach ( d4u_partners( 'd4u_rider' ) as $u ) {
		echo '<option value="' . esc_attr( $u->ID ) . '"' . selected( $rd, $u->ID, false ) . '>' . esc_html( d4u_partner_name( $u->ID ) ) . '</option>';
	}
	echo '</select></label></p>';
	echo '<p class="description">Prescription “Approved” on an order in Prescription check moves it to Processing when you save.</p>';
}

add_action( 'woocommerce_process_shop_order_meta', function ( $order_id ) {
	if ( ! isset( $_POST['d4u_order_box_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['d4u_order_box_nonce'] ) ), 'd4u_order_box' ) ) {
		return;
	}
	if ( ! current_user_can( 'edit_shop_orders' ) && ! current_user_can( 'manage_woocommerce' ) ) {
		return;
	}
	$order = wc_get_order( $order_id );
	if ( ! $order ) {
		return;
	}
	$ph = isset( $_POST['d4u_pharmacy'] ) ? absint( $_POST['d4u_pharmacy'] ) : 0;
	if ( $ph !== (int) $order->get_meta( '_d4u_pharmacy' ) ) {
		$order->update_meta_data( '_d4u_pharmacy', $ph );
		$order->add_order_note( $ph ? 'Pharmacy set to ' . d4u_partner_name( $ph ) . '.' : 'Pharmacy removed.' );
	}
	$rd = isset( $_POST['d4u_rider'] ) ? absint( $_POST['d4u_rider'] ) : 0;
	if ( $rd !== (int) $order->get_meta( '_d4u_rider' ) ) {
		$order->update_meta_data( '_d4u_rider', $rd );
		$order->add_order_note( $rd ? 'Rider set to ' . d4u_partner_name( $rd ) . '.' : 'Rider removed.' );
	}
	$approve = false;
	if ( isset( $_POST['d4u_rx_state'] ) ) {
		$st = sanitize_key( wp_unslash( $_POST['d4u_rx_state'] ) );
		if ( in_array( $st, array( '', 'pending', 'approved', 'rejected' ), true ) && $st !== (string) $order->get_meta( '_d4u_rx_state' ) ) {
			$order->update_meta_data( '_d4u_rx_state', $st );
			$order->add_order_note( 'Prescription status: ' . ( $st ? $st : 'cleared' ) . ' (by ' . wp_get_current_user()->display_name . ').' );
			$approve = ( 'approved' === $st );
		}
	}
	$order->save();
	if ( $approve && $order->has_status( 'd4u-rx' ) ) {
		$order->update_status( 'processing' );
	}
	if ( $ph && $order->has_status( array( 'd4u-rx', 'd4u-request', 'processing' ) ) ) {
		d4u_mail_pharmacy_once( $order );
	}
}, 60 );

/* ------------------------------------------------------------------ what the customer sees on their order */

function d4u_track_steps( $order ) {
	$s     = $order->get_status();
	$rx    = d4u_order_has_rx_items( $order ) || $order->get_meta( '_d4u_rx_files' );
	$steps = array( 'placed' => 'Order placed' );
	if ( $rx ) {
		$steps['rx'] = 'Prescription checked';
	}
	$steps['pack'] = 'Packed';
	$steps['out']  = 'On the way';
	$steps['done'] = 'Delivered';
	$at            = array(
		'd4u-request' => 'placed',
		'pending'     => 'placed',
		'on-hold'     => 'placed',
		'd4u-rx'      => 'placed',
		'processing'  => $rx ? 'rx' : 'placed',
		'd4u-ready'   => 'pack',
		'd4u-out'     => 'out',
		'completed'   => 'done',
	);
	if ( ! isset( $at[ $s ] ) ) {
		return '';
	}
	$keys = array_keys( $steps );
	$pos  = array_search( $at[ $s ], $keys, true );
	$html = '<ol class="d4u-steps">';
	foreach ( $keys as $i => $k ) {
		$cls   = $i < $pos ? 'done' : ( $i === $pos ? 'now' : '' );
		$cls   = ( $i === $pos && 'done' === $at[ $s ] ) ? 'done' : $cls;
		$html .= '<li class="' . esc_attr( $cls ) . '">' . esc_html( $steps[ $k ] ) . '</li>';
	}
	return $html . '</ol>';
}

add_action( 'woocommerce_order_details_before_order_table', function ( $order ) {
	echo d4u_flash_html(); // phpcs:ignore -- escaped inside
	if ( ! $order instanceof WC_Order || d4u_order_only_pass( $order ) ) {
		return;
	}
	$s = $order->get_status();
	echo '<section class="d4u-track">';
	echo d4u_track_steps( $order ); // phpcs:ignore -- escaped inside

	$msg = '';
	$pay = false;
	switch ( $s ) {
		case 'd4u-request':
			$msg = 'A licensed pharmacist is reading your prescription. We will email you the medicines and the price — you pay only after that.';
			break;
		case 'd4u-rx':
			$msg = 'A licensed pharmacist is checking your prescription. Your order is packed as soon as it is approved.';
			break;
		case 'pending':
			if ( 'approved' === $order->get_meta( '_d4u_rx_state' ) && $order->get_item_count() ) {
				$msg = 'Your pharmacist added your medicines. Check the list below, then pay to get them delivered.';
				$pay = true;
			} elseif ( $order->needs_payment() && 'cod' !== $order->get_payment_method() && $order->get_item_count() ) {
				$msg = 'Your payment didn’t finish, so this order is waiting. Try paying again with the button below. If money already left your account, write to us from Help and we’ll sort it out.';
				$pay = true;
			}
			break;
		case 'on-hold':
			if ( 'wc-upi' === $order->get_payment_method() ) {
				$msg = 'We are checking your UPI payment. This usually takes a few minutes.';
			}
			break;
		case 'processing':
			$msg = 'Your medicines are being packed at the pharmacy.';
			break;
		case 'd4u-ready':
			$msg = 'Packed! A rider will pick it up in a few minutes.';
			break;
		case 'd4u-out':
			$rider = (int) $order->get_meta( '_d4u_rider' );
			$msg   = 'Your order is on the way.';
			if ( $rider ) {
				$phone = get_user_meta( $rider, 'd4u_phone', true );
				$msg  .= ' Rider: ' . d4u_partner_name( $rider ) . ( $phone ? ' · ' . $phone : '' ) . '.';
			}
			break;
		case 'cancelled':
			if ( 'rejected' === $order->get_meta( '_d4u_rx_state' ) ) {
				$msg = 'The pharmacist could not accept the prescription' . ( $order->get_meta( '_d4u_rx_reason' ) ? ': ' . $order->get_meta( '_d4u_rx_reason' ) : '' ) . '. If you paid online, the money goes back to the card, UPI or bank account you paid with — banks can take up to 7 working days.';
			}
			break;
	}
	if ( $msg ) {
		echo '<p class="d4u-track__msg">' . esc_html( $msg ) . '</p>';
	}
	if ( $pay ) {
		echo '<p><a class="button d4u-btn-gold" href="' . esc_url( $order->get_checkout_payment_url() ) . '">Pay ' . wp_kses_post( wc_price( $order->get_total() ) ) . '</a></p>';
	}
	if ( $order->has_status( array( 'processing', 'd4u-ready', 'd4u-out' ) ) && $order->get_meta( '_d4u_code' ) ) {
		echo '<p class="d4u-code">Delivery code <strong>' . esc_html( $order->get_meta( '_d4u_code' ) ) . '</strong><span>Tell this to the rider when your order arrives.</span></p>';
	}
	if ( 'd4u-out' === $s ) {
		$rider = (int) $order->get_meta( '_d4u_rider' );
		$phone = $rider ? preg_replace( '/[^0-9+]/', '', (string) get_user_meta( $rider, 'd4u_phone', true ) ) : '';
		if ( $phone ) {
			echo '<p><a class="button" href="tel:' . esc_attr( $phone ) . '">Call rider</a></p>';
		}
	}
	$files = array_values( array_filter( (array) $order->get_meta( '_d4u_rx_files' ) ) );
	if ( $files ) {
		echo '<p class="d4u-files">Prescription: ';
		foreach ( $files as $i => $f ) {
			echo ( $i ? ' · ' : '' ) . '<a href="' . esc_url( d4u_rx_file_url( $order, $i ) ) . '" target="_blank" rel="noopener">' . esc_html( $f['name'] ? $f['name'] : 'File ' . ( $i + 1 ) ) . '</a>';
		}
		echo '</p>';
	}
	echo '</section>';
	if ( $order->has_status( array( 'd4u-request', 'd4u-rx', 'processing', 'd4u-ready', 'd4u-out', 'on-hold' ) ) ) {
		echo '<script>setTimeout(function(){if(!document.hidden)location.reload()},45000)</script>';
	}
}, 5 );
