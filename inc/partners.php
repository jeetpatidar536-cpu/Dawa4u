<?php
/**
 * Pharmacy and rider accounts (sign up, email verification, log in), the contact form,
 * and the "Upload prescription" page for customers.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ------------------------------------------------------------------ helpers */

function d4u_form_open( $action, $class = '', $multipart = false ) {
	$out  = '<form method="post" class="d4u-form ' . esc_attr( $class ) . '"' . ( $multipart ? ' enctype="multipart/form-data"' : '' ) . ' action="' . esc_url( get_permalink() ) . '">';
	$out .= '<input type="hidden" name="d4u_action" value="' . esc_attr( $action ) . '">';
	$out .= '<input type="hidden" name="d4u_nonce" value="' . esc_attr( wp_create_nonce( 'd4u_' . $action ) ) . '">';
	$out .= wp_referer_field( false );
	return $out;
}

/** Values typed before a failed form submit, so people don't have to type them again. */
function d4u_old( $key ) {
	static $data = null;
	if ( null === $data ) {
		$data = array();
		if ( ! empty( $_GET['d4u_flash'] ) ) { // phpcs:ignore
			$k = preg_replace( '/[^A-Za-z0-9]/', '', sanitize_text_field( wp_unslash( $_GET['d4u_flash'] ) ) ); // phpcs:ignore
			$f = get_transient( 'd4u_flash_' . $k );
			if ( is_array( $f ) && ! empty( $f[2] ) && is_array( $f[2] ) ) {
				$data = $f[2];
			}
		}
	}
	return isset( $data[ $key ] ) ? (string) $data[ $key ] : '';
}

function d4u_field( $name, $label, $type = 'text', $attrs = '' ) {
	$val = 'password' === $type ? '' : d4u_old( $name );
	return '<label class="d4u-field"><span>' . esc_html( $label ) . '</span><input type="' . esc_attr( $type ) . '" name="' . esc_attr( $name ) . '" value="' . esc_attr( $val ) . '" ' . $attrs . '></label>';
}

/** Go back with an error and keep what was typed (never the password). */
function d4u_fail( $errors, $view = '' ) {
	$keep = array();
	foreach ( wp_unslash( $_POST ) as $k => $v ) { // phpcs:ignore
		if ( is_string( $v ) && ! in_array( $k, array( 'password', 'pwd', 'd4u_nonce', '_wp_http_referer' ), true ) ) {
			$keep[ sanitize_key( $k ) ] = sanitize_textarea_field( $v );
		}
	}
	$key = wp_generate_password( 10, false );
	set_transient( 'd4u_flash_' . $key, array( implode( '<br>', array_map( 'esc_html', (array) $errors ) ), 'error', $keep ), 300 );
	$url = remove_query_arg( array( 'd4u_flash', 'd4u_verify', 'u' ), wp_validate_redirect( wp_get_raw_referer(), home_url( '/' ) ) );
	if ( $view ) {
		$url = add_query_arg( 'view', $view, $url );
	}
	wp_safe_redirect( add_query_arg( 'd4u_flash', $key, $url ) );
	exit;
}

function d4u_clean_phone( $p ) {
	$p = preg_replace( '/\D/', '', (string) $p );
	return substr( $p, -10 );
}

function d4u_partner_home( $user ) {
	if ( ! $user instanceof WP_User ) {
		return '';
	}
	if ( in_array( 'd4u_pharmacy', (array) $user->roles, true ) ) {
		return d4u_page_url( 'pharmacy' );
	}
	if ( in_array( 'd4u_rider', (array) $user->roles, true ) ) {
		return d4u_page_url( 'rider' );
	}
	return '';
}

/* ------------------------------------------------------------------ log in rules */

// A partner can't log in until their email is verified.
add_filter( 'wp_authenticate_user', function ( $user ) {
	if ( $user instanceof WP_User && array_intersect( array( 'd4u_pharmacy', 'd4u_rider' ), (array) $user->roles ) && 'unverified' === d4u_status( $user->ID ) ) {
		return new WP_Error( 'd4u_unverified', 'Please verify your email first — open the link we sent to ' . esc_html( $user->user_email ) . '. Use “Send the link again” below if you can’t find it.' );
	}
	return $user;
}, 30 );

add_filter( 'woocommerce_login_redirect', function ( $redirect, $user ) {
	$home = d4u_partner_home( $user );
	return $home ? $home : $redirect;
}, 10, 2 );

add_filter( 'login_redirect', function ( $redirect, $requested, $user ) {
	$home = d4u_partner_home( $user );
	return $home ? $home : $redirect;
}, 10, 3 );

// Our pages show live, per-person information: never cache them.
add_action( 'template_redirect', function () {
	if ( ! is_page() ) {
		return;
	}
	$id = get_queried_object_id();
	foreach ( array( 'pharmacy', 'rider', 'rx' ) as $k ) {
		if ( (int) get_option( 'd4u_page_' . $k ) === $id ) {
			if ( ! defined( 'DONOTCACHEPAGE' ) ) {
				define( 'DONOTCACHEPAGE', true );
			}
			nocache_headers();
			header( 'X-LiteSpeed-Cache-Control: no-cache' );
			return;
		}
	}
	if ( is_page( 'help' ) && ! defined( 'DONOTCACHEPAGE' ) ) {
		define( 'DONOTCACHEPAGE', true );
		header( 'X-LiteSpeed-Cache-Control: no-cache' );
	}
}, 1 );

/* ------------------------------------------------------------------ all dawa4u forms post here */

add_action( 'template_redirect', function () {
	if ( 'POST' !== ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) || empty( $_POST['d4u_action'] ) ) { // phpcs:ignore
		return;
	}
	$action = sanitize_key( wp_unslash( $_POST['d4u_action'] ) );
	$nonce  = isset( $_POST['d4u_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['d4u_nonce'] ) ) : '';
	if ( ! wp_verify_nonce( $nonce, 'd4u_' . $action ) ) {
		d4u_back( 'This page was open too long. Please try again.', 'error' );
	}
	$allowed = array( 'login', 'register_pharmacy', 'register_rider', 'resend', 'contact', 'rx_request', 'ph_open', 'ph_profile', 'ph_rx', 'ph_packed', 'ph_fill', 'ph_key', 'ph_hook', 'ph_stock', 'ph_pass', 'rd_online', 'rd_profile', 'rd_take', 'rd_picked', 'rd_delivered' );
	$fn      = 'd4u_do_' . $action;
	if ( in_array( $action, $allowed, true ) && function_exists( $fn ) ) {
		call_user_func( $fn );
	}
	d4u_back( 'Something went wrong. Please try again.', 'error' );
}, 5 );

/* ------------------------------------------------------------------ log in / sign up */

function d4u_do_login() {
	$login = isset( $_POST['log'] ) ? sanitize_text_field( wp_unslash( $_POST['log'] ) ) : ''; // phpcs:ignore
	$pass  = isset( $_POST['pwd'] ) ? (string) wp_unslash( $_POST['pwd'] ) : ''; // phpcs:ignore
	$user  = wp_signon( array( 'user_login' => $login, 'user_password' => $pass, 'remember' => true ), is_ssl() );
	if ( is_wp_error( $user ) ) {
		$msg = 'd4u_unverified' === $user->get_error_code() ? $user->get_error_message() : 'That email and password don’t match. Try again, or use “Forgot password?”.';
		d4u_fail( array( wp_strip_all_tags( $msg ) ) );
	}
	$home = d4u_partner_home( $user );
	d4u_back( '', 'ok', $home ? $home : wc_get_page_permalink( 'myaccount' ) );
}

function d4u_unique_login( $email ) {
	$base  = sanitize_user( strstr( $email, '@', true ), true );
	$base  = $base ? $base : 'partner';
	$login = $base;
	$i     = 1;
	while ( username_exists( $login ) ) {
		$login = $base . ( ++$i );
	}
	return $login;
}

function d4u_register( $role ) {
	$p      = wp_unslash( $_POST ); // phpcs:ignore
	$email  = sanitize_email( isset( $p['email'] ) ? $p['email'] : '' );
	$name   = sanitize_text_field( isset( $p['name'] ) ? $p['name'] : '' );
	$phone  = d4u_clean_phone( isset( $p['phone'] ) ? $p['phone'] : '' );
	$pass   = isset( $p['password'] ) ? (string) $p['password'] : '';
	$pins   = d4u_parse_pins( isset( $p['pins'] ) ? $p['pins'] : '' );
	$lic    = sanitize_text_field( isset( $p['licence'] ) ? $p['licence'] : '' );
	$errors = array();

	if ( ! is_email( $email ) ) {
		$errors[] = 'Enter a valid email address.';
	} elseif ( email_exists( $email ) ) {
		$errors[] = 'This email already has an account. Log in instead — or use “Send the link again” if you haven’t verified it yet.';
	}
	if ( strlen( $name ) < 2 ) {
		$errors[] = 'Enter your full name.';
	}
	if ( ! preg_match( '/^[6-9]\d{9}$/', $phone ) ) {
		$errors[] = 'Enter a 10-digit mobile number.';
	}
	if ( strlen( $pass ) < 8 ) {
		$errors[] = 'Choose a password with at least 8 characters.';
	}
	if ( ! $pins ) {
		$errors[] = 'Add at least one 6-digit PIN code where you deliver.';
	}
	if ( 'd4u_pharmacy' === $role ) {
		$shop    = sanitize_text_field( isset( $p['shop'] ) ? $p['shop'] : '' );
		$address = sanitize_textarea_field( isset( $p['address'] ) ? $p['address'] : '' );
		$city    = sanitize_text_field( isset( $p['city'] ) ? $p['city'] : '' );
		if ( strlen( $shop ) < 2 ) {
			$errors[] = 'Enter the pharmacy name.';
		}
		if ( strlen( $lic ) < 3 ) {
			$errors[] = 'Enter your drug licence number.';
		}
		if ( strlen( $address ) < 5 || strlen( $city ) < 2 ) {
			$errors[] = 'Enter the pharmacy address and city.';
		}
	} else {
		$vehicle = sanitize_key( isset( $p['vehicle'] ) ? $p['vehicle'] : '' );
		if ( ! in_array( $vehicle, array( 'bike', 'scooter', 'ev', 'cycle' ), true ) ) {
			$errors[] = 'Choose your vehicle.';
		}
		if ( 'cycle' !== $vehicle && strlen( $lic ) < 5 ) {
			$errors[] = 'Enter your driving licence number.';
		}
	}
	if ( $errors ) {
		d4u_fail( $errors, 'register' );
	}

	$uid = wp_insert_user( array(
		'user_login'   => d4u_unique_login( $email ),
		'user_email'   => $email,
		'user_pass'    => $pass,
		'display_name' => $name,
		'first_name'   => $name,
		'role'         => $role,
	) );
	if ( is_wp_error( $uid ) ) {
		d4u_fail( array( $uid->get_error_message() ), 'register' );
	}
	update_user_meta( $uid, 'd4u_status', 'unverified' );
	update_user_meta( $uid, 'd4u_phone', $phone );
	update_user_meta( $uid, 'billing_phone', $phone );
	update_user_meta( $uid, 'd4u_pins', $pins );
	update_user_meta( $uid, 'd4u_licence', $lic );
	if ( 'd4u_pharmacy' === $role ) {
		update_user_meta( $uid, 'd4u_shop', $shop );
		update_user_meta( $uid, 'd4u_address', $address );
		update_user_meta( $uid, 'd4u_city', $city );
		update_user_meta( $uid, 'd4u_open', 'no' );
	} else {
		update_user_meta( $uid, 'd4u_vehicle', $vehicle );
		update_user_meta( $uid, 'd4u_online', 'no' );
	}
	d4u_send_verify( $uid );
	d4u_back( 'Account created. We sent a link to <strong>' . esc_html( $email ) . '</strong> — open it to verify your email. If you can’t see it in a few minutes, check Spam.', 'ok' );
}

function d4u_do_register_pharmacy() {
	d4u_register( 'd4u_pharmacy' );
}

function d4u_do_register_rider() {
	d4u_register( 'd4u_rider' );
}

function d4u_send_verify( $uid ) {
	$u = get_userdata( $uid );
	if ( ! $u ) {
		return;
	}
	$token = wp_generate_password( 32, false );
	update_user_meta( $uid, 'd4u_verify_hash', wp_hash( $token ) );
	update_user_meta( $uid, 'd4u_verify_exp', time() + 2 * DAY_IN_SECONDS );
	$page = d4u_is_pharmacy( $uid ) ? d4u_page_url( 'pharmacy' ) : d4u_page_url( 'rider' );
	$link = add_query_arg( array( 'd4u_verify' => $token, 'u' => $uid ), $page );
	d4u_mail(
		$u->user_email,
		'Verify your email for dawa4u',
		'Verify your email',
		'<p>Hello ' . esc_html( $u->display_name ) . ',</p><p>Please confirm that this is your email address:</p>' .
		'<p><a href="' . esc_url( $link ) . '" style="display:inline-block;padding:12px 22px;background:#15370D;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:bold">Verify my email</a></p>' .
		'<p>If the button doesn’t work, open this link:<br>' . esc_html( $link ) . '</p><p>The link works for 2 days. If you didn’t sign up for dawa4u, you can ignore this email.</p>'
	);
}

function d4u_do_resend() {
	$email = sanitize_email( isset( $_POST['email'] ) ? wp_unslash( $_POST['email'] ) : '' ); // phpcs:ignore
	$u     = $email ? get_user_by( 'email', $email ) : false;
	if ( $u && array_intersect( array( 'd4u_pharmacy', 'd4u_rider' ), (array) $u->roles ) && 'unverified' === d4u_status( $u->ID ) && ! get_transient( 'd4u_rs_' . $u->ID ) ) {
		set_transient( 'd4u_rs_' . $u->ID, 1, MINUTE_IN_SECONDS );
		d4u_send_verify( $u->ID );
	}
	// Same answer either way, so this can't be used to find out who has an account.
	d4u_back( 'If that email has an account waiting for verification, we sent a new link. Check Spam too. You can ask again after a minute.', 'ok' );
}

// The link in the email.
add_action( 'template_redirect', function () {
	if ( empty( $_GET['d4u_verify'] ) || empty( $_GET['u'] ) ) { // phpcs:ignore
		return;
	}
	$uid   = absint( $_GET['u'] ); // phpcs:ignore
	$token = preg_replace( '/[^A-Za-z0-9]/', '', sanitize_text_field( wp_unslash( $_GET['d4u_verify'] ) ) ); // phpcs:ignore
	$user  = get_userdata( $uid );
	$page  = $user ? d4u_partner_home( $user ) : home_url( '/' );
	if ( ! $user || ! $page ) {
		d4u_back( 'This link is not valid.', 'error', home_url( '/' ) );
	}
	$hash = (string) get_user_meta( $uid, 'd4u_verify_hash', true );
	if ( ! $hash || ! hash_equals( $hash, wp_hash( $token ) ) ) {
		if ( 'unverified' !== d4u_status( $uid ) ) {
			d4u_back( 'Your email is already verified. Please log in.', 'ok', $page );
		}
		d4u_back( 'This link is not valid any more. Ask for a new one below.', 'error', $page );
	}
	if ( (int) get_user_meta( $uid, 'd4u_verify_exp', true ) < time() ) {
		d4u_back( 'This link has expired. Ask for a new one below.', 'error', $page );
	}
	delete_user_meta( $uid, 'd4u_verify_hash' );
	delete_user_meta( $uid, 'd4u_verify_exp' );
	update_user_meta( $uid, 'd4u_email_verified', time() );
	if ( 'unverified' === d4u_status( $uid ) ) {
		update_user_meta( $uid, 'd4u_status', 'pending' );
		$kind = d4u_is_pharmacy( $uid ) ? 'pharmacy' : 'rider';
		d4u_mail(
			get_option( 'admin_email' ),
			'New ' . $kind . ' to approve: ' . d4u_partner_name( $uid ),
			'New ' . $kind . ' to approve',
			'<p><strong>' . esc_html( d4u_partner_name( $uid ) ) . '</strong> verified their email and is waiting for approval.</p><p><a href="' . esc_url( admin_url( 'admin.php?page=d4u-partners' ) ) . '">Review in WooCommerce → dawa4u partners</a></p>'
		);
	}
	wp_set_current_user( $uid );
	wp_set_auth_cookie( $uid, true, is_ssl() );
	d4u_back( 'Thank you — your email is verified. The dawa4u team will now check your details and approve your account. We’ll email you.', 'ok', $page );
}, 4 );

/** Log in + sign up + "send the link again", for the pharmacy and rider pages. */
function d4u_auth_screen( $kind ) {
	$is_ph = 'pharmacy' === $kind;
	$view  = isset( $_GET['view'] ) && 'register' === $_GET['view'] ? 'register' : 'login'; // phpcs:ignore
	$base  = remove_query_arg( array( 'view', 'd4u_flash' ) );
	$out   = '<div class="d4u-auth">';
	$out  .= '<div class="d4u-tabs"><a class="' . ( 'login' === $view ? 'on' : '' ) . '" href="' . esc_url( $base ) . '">Log in</a><a class="' . ( 'register' === $view ? 'on' : '' ) . '" href="' . esc_url( add_query_arg( 'view', 'register', $base ) ) . '">' . ( $is_ph ? 'Register your pharmacy' : 'Become a rider' ) . '</a></div>';

	if ( 'login' === $view ) {
		$out .= d4u_form_open( 'login', 'd4u-card' );
		$out .= d4u_field( 'log', 'Email', 'email', 'required autocomplete="username"' );
		$out .= d4u_field( 'pwd', 'Password', 'password', 'required autocomplete="current-password"' );
		$out .= '<button class="d4u-btn" type="submit">Log in</button>';
		$out .= '<p class="d4u-small"><a href="' . esc_url( wp_lostpassword_url( get_permalink() ) ) . '">Forgot password?</a></p></form>';
		$out .= d4u_form_open( 'resend', 'd4u-card d4u-card--soft' );
		$out .= '<p class="d4u-small"><strong>Didn’t get the email link?</strong></p>';
		$out .= d4u_field( 'email', 'Your email', 'email', 'required' );
		$out .= '<button class="d4u-btn d4u-btn--ghost" type="submit">Send the link again</button></form>';
	} else {
		$out .= d4u_form_open( $is_ph ? 'register_pharmacy' : 'register_rider', 'd4u-card' );
		if ( $is_ph ) {
			$out .= d4u_field( 'shop', 'Pharmacy name', 'text', 'required' );
			$out .= d4u_field( 'name', 'Owner / pharmacist name', 'text', 'required autocomplete="name"' );
			$out .= d4u_field( 'licence', 'Drug licence number', 'text', 'required' );
			$out .= '<label class="d4u-field"><span>Pharmacy address</span><textarea name="address" rows="2" required>' . esc_textarea( d4u_old( 'address' ) ) . '</textarea></label>';
			$out .= d4u_field( 'city', 'City / town / village', 'text', 'required' );
		} else {
			$out .= d4u_field( 'name', 'Full name', 'text', 'required autocomplete="name"' );
			$v    = d4u_old( 'vehicle' );
			$out .= '<label class="d4u-field"><span>Vehicle</span><select name="vehicle" required><option value="">Choose…</option>';
			foreach ( array( 'bike' => 'Motorbike', 'scooter' => 'Scooter', 'ev' => 'Electric scooter', 'cycle' => 'Bicycle' ) as $k => $l ) {
				$out .= '<option value="' . esc_attr( $k ) . '"' . selected( $v, $k, false ) . '>' . esc_html( $l ) . '</option>';
			}
			$out .= '</select></label>';
			$out .= d4u_field( 'licence', 'Driving licence number (not needed for a bicycle)', 'text' );
		}
		$out .= d4u_field( 'phone', 'Mobile number', 'tel', 'required inputmode="numeric" autocomplete="tel"' );
		$out .= d4u_field( 'pins', $is_ph ? 'PIN codes you deliver to (comma-separated)' : 'PIN codes where you can deliver (comma-separated)', 'text', 'required inputmode="numeric" placeholder="e.g. 452001, 452002"' );
		$out .= d4u_field( 'email', 'Email', 'email', 'required autocomplete="email"' );
		$out .= d4u_field( 'password', 'Password (at least 8 characters)', 'password', 'required minlength="8" autocomplete="new-password"' );
		$out .= '<p class="d4u-small">We send a link to your email to verify it. After that, the dawa4u team checks your details and approves your account.</p>';
		$out .= '<button class="d4u-btn" type="submit">Create account</button></form>';
	}
	return $out . '</div>';
}

/* ------------------------------------------------------------------ contact form (Help page) */

add_shortcode( 'dawa4u_contact', function () {
	$u    = wp_get_current_user();
	$out  = '<div class="d4u-contact" id="write">' . d4u_flash_html();
	$out .= d4u_form_open( 'contact', 'd4u-card' );
	$out .= '<div class="d4u-grid2">';
	$out .= '<label class="d4u-field"><span>Your name</span><input type="text" name="name" required value="' . esc_attr( $u->ID ? $u->display_name : d4u_old( 'name' ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>Mobile number</span><input type="tel" name="phone" value="' . esc_attr( d4u_old( 'phone' ) ) . '"></label>';
	$out .= '</div>';
	$out .= '<label class="d4u-field"><span>Email</span><input type="email" name="email" required value="' . esc_attr( $u->ID ? $u->user_email : d4u_old( 'email' ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>Order number (if it is about an order)</span><input type="text" name="order" value="' . esc_attr( d4u_old( 'order' ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>Message</span><textarea name="message" rows="4" required>' . esc_textarea( d4u_old( 'message' ) ) . '</textarea></label>';
	$out .= '<label class="d4u-hp" aria-hidden="true">Leave empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label>';
	$out .= '<button class="d4u-btn" type="submit">Send message</button></form></div>';
	return $out;
} );

function d4u_do_contact() {
	$p = wp_unslash( $_POST ); // phpcs:ignore
	if ( ! empty( $p['website'] ) ) {
		d4u_back( 'Thank you — we got your message.', 'ok' );
	}
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'd4u_ct_' . md5( $ip );
	if ( get_transient( $key ) ) {
		d4u_fail( array( 'Please wait a minute before sending another message.' ) );
	}
	$name  = sanitize_text_field( isset( $p['name'] ) ? $p['name'] : '' );
	$email = sanitize_email( isset( $p['email'] ) ? $p['email'] : '' );
	$phone = sanitize_text_field( isset( $p['phone'] ) ? $p['phone'] : '' );
	$ord   = sanitize_text_field( isset( $p['order'] ) ? $p['order'] : '' );
	$msg   = sanitize_textarea_field( isset( $p['message'] ) ? $p['message'] : '' );
	if ( ! $name || ! is_email( $email ) || strlen( $msg ) < 5 ) {
		d4u_fail( array( 'Please fill in your name, a valid email and your message.' ) );
	}
	set_transient( $key, 1, MINUTE_IN_SECONDS );
	$body = "From: {$name}\nEmail: {$email}\nMobile: {$phone}\nOrder: {$ord}\n\n{$msg}\n";
	wp_mail( get_option( 'admin_email' ), 'dawa4u help: ' . $name, $body, array( 'Reply-To: ' . $name . ' <' . $email . '>' ) );
	d4u_back( 'Thank you — we got your message and will reply soon.', 'ok' );
}

/* ------------------------------------------------------------------ Upload prescription (customers) */

add_shortcode( 'dawa4u_rx_upload', function () {
	$out = '<div class="d4u-rxpage">' . d4u_flash_html();
	if ( ! is_user_logged_in() ) {
		$out .= '<p class="d4-lead">Send a photo of your prescription. A licensed pharmacist reads it, adds your medicines and sends you the price. You pay only after that.</p>';
		$out .= '<div class="d4u-card"><p><strong>Log in to send your prescription</strong> — so we can tell you when it’s ready.</p>';
		ob_start();
		woocommerce_login_form( array( 'redirect' => get_permalink(), 'hidden' => false ) );
		$out .= ob_get_clean();
		$out .= '<p class="d4u-small">New to dawa4u? <a href="' . esc_url( wc_get_page_permalink( 'myaccount' ) ) . '">Create an account</a>, then come back here.</p></div></div>';
		return $out;
	}
	$u      = wp_get_current_user();
	$uid    = $u->ID;
	$val    = function ( $k, $meta ) use ( $uid ) {
		$o = d4u_old( $k );
		return '' !== $o ? $o : (string) get_user_meta( $uid, $meta, true );
	};
	$states = WC()->countries->get_states( 'IN' );
	$st     = $val( 'state', 'billing_state' );

	$out .= '<p class="d4-lead">Send a photo of your prescription. A licensed pharmacist reads it, adds your medicines and emails you the price. You pay only after that.</p>';
	$out .= d4u_form_open( 'rx_request', 'd4u-card', true );
	$out .= '<label class="d4u-field"><span>Prescription (photo or PDF — up to 5 files)</span><input type="file" name="rx[]" accept="image/*,application/pdf" multiple required></label>';
	$out .= '<div class="d4u-grid2">';
	$out .= '<label class="d4u-field"><span>Name</span><input type="text" name="name" required value="' . esc_attr( '' !== d4u_old( 'name' ) ? d4u_old( 'name' ) : trim( $u->first_name . ' ' . $u->last_name ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>Mobile number</span><input type="tel" name="phone" required inputmode="numeric" value="' . esc_attr( $val( 'phone', 'billing_phone' ) ) . '"></label>';
	$out .= '</div>';
	$out .= '<label class="d4u-field"><span>House, street and area</span><input type="text" name="address_1" required value="' . esc_attr( $val( 'address_1', 'billing_address_1' ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>Landmark (optional)</span><input type="text" name="address_2" value="' . esc_attr( $val( 'address_2', 'billing_address_2' ) ) . '"></label>';
	$out .= '<div class="d4u-grid3">';
	$out .= '<label class="d4u-field"><span>City / town / village</span><input type="text" name="city" required value="' . esc_attr( $val( 'city', 'billing_city' ) ) . '"></label>';
	$out .= '<label class="d4u-field"><span>State</span><select name="state" required><option value="">Choose…</option>';
	foreach ( (array) $states as $code => $label ) {
		$out .= '<option value="' . esc_attr( $code ) . '"' . selected( $st, $code, false ) . '>' . esc_html( $label ) . '</option>';
	}
	$out .= '</select></label>';
	$out .= '<label class="d4u-field"><span>PIN code</span><input type="text" name="pin" required inputmode="numeric" maxlength="6" value="' . esc_attr( $val( 'pin', 'billing_postcode' ) ) . '"></label>';
	$out .= '</div>';
	$out .= '<label class="d4u-field"><span>Note for the pharmacist (optional)</span><textarea name="note" rows="2" placeholder="For example: only the medicines for 5 days">' . esc_textarea( d4u_old( 'note' ) ) . '</textarea></label>';
	$out .= '<button class="d4u-btn" type="submit">Send to pharmacist</button>';
	$out .= '<p class="d4u-small">Only the pharmacist handling your order and the dawa4u team can see your prescription.</p></form></div>';
	return $out;
} );

function d4u_do_rx_request() {
	if ( ! is_user_logged_in() ) {
		d4u_fail( array( 'Please log in first.' ) );
	}
	$p      = wp_unslash( $_POST ); // phpcs:ignore
	$name   = sanitize_text_field( isset( $p['name'] ) ? $p['name'] : '' );
	$phone  = d4u_clean_phone( isset( $p['phone'] ) ? $p['phone'] : '' );
	$a1     = sanitize_text_field( isset( $p['address_1'] ) ? $p['address_1'] : '' );
	$a2     = sanitize_text_field( isset( $p['address_2'] ) ? $p['address_2'] : '' );
	$city   = sanitize_text_field( isset( $p['city'] ) ? $p['city'] : '' );
	$state  = sanitize_text_field( isset( $p['state'] ) ? $p['state'] : '' );
	$pin    = preg_replace( '/\D/', '', isset( $p['pin'] ) ? $p['pin'] : '' );
	$note   = sanitize_textarea_field( isset( $p['note'] ) ? $p['note'] : '' );
	$errors = array();
	if ( strlen( $name ) < 2 ) {
		$errors[] = 'Enter your name.';
	}
	if ( ! preg_match( '/^[6-9]\d{9}$/', $phone ) ) {
		$errors[] = 'Enter a 10-digit mobile number.';
	}
	if ( strlen( $a1 ) < 3 || strlen( $city ) < 2 || ! $state ) {
		$errors[] = 'Enter your full address.';
	}
	if ( 6 !== strlen( $pin ) ) {
		$errors[] = 'Enter your 6-digit PIN code.';
	} elseif ( d4u_pin_check_on() && ! d4u_find_pharmacy( $pin ) ) {
		$errors[] = 'Sorry, we don’t deliver to PIN ' . $pin . ' yet.';
	}

	// Files.
	$list = array();
	if ( ! empty( $_FILES['rx']['name'] ) && is_array( $_FILES['rx']['name'] ) ) { // phpcs:ignore
		foreach ( array_keys( $_FILES['rx']['name'] ) as $i ) { // phpcs:ignore
			if ( '' === $_FILES['rx']['name'][ $i ] ) { // phpcs:ignore
				continue;
			}
			$list[] = array(
				'name'     => $_FILES['rx']['name'][ $i ], // phpcs:ignore
				'type'     => $_FILES['rx']['type'][ $i ], // phpcs:ignore
				'tmp_name' => $_FILES['rx']['tmp_name'][ $i ], // phpcs:ignore
				'error'    => $_FILES['rx']['error'][ $i ], // phpcs:ignore
				'size'     => $_FILES['rx']['size'][ $i ], // phpcs:ignore
			);
		}
	}
	if ( ! $list ) {
		$errors[] = 'Add a photo or PDF of your prescription.';
	} elseif ( count( $list ) > 5 ) {
		$errors[] = 'You can send up to 5 files.';
	}
	if ( $errors ) {
		d4u_fail( $errors );
	}
	$files = array();
	foreach ( $list as $f ) {
		$r = d4u_store_rx_file( $f );
		if ( is_wp_error( $r ) ) {
			d4u_fail( array( $r->get_error_message() ) );
		}
		$files[] = $r;
	}

	$uid   = get_current_user_id();
	$order = wc_create_order( array( 'customer_id' => $uid, 'created_via' => 'dawa4u-rx' ) );
	if ( is_wp_error( $order ) ) {
		d4u_fail( array( 'Could not send it. Please try again.' ) );
	}
	$addr = array(
		'first_name' => $name,
		'phone'      => $phone,
		'address_1'  => $a1,
		'address_2'  => $a2,
		'city'       => $city,
		'state'      => $state,
		'postcode'   => $pin,
		'country'    => 'IN',
	);
	$order->set_address( array_merge( $addr, array( 'email' => wp_get_current_user()->user_email ) ), 'billing' );
	unset( $addr['phone'] );
	$order->set_address( $addr, 'shipping' );
	$order->set_customer_note( $note );
	$order->update_meta_data( '_d4u_rx_files', $files );
	$order->update_meta_data( '_d4u_rx_state', 'pending' );
	$order->update_meta_data( '_d4u_rx_request', 'yes' );
	d4u_prepare_order( $order );
	$order->save();
	$order->update_status( 'd4u-request', 'Prescription sent by the customer.' );

	foreach ( array( 'billing_phone' => $phone, 'billing_address_1' => $a1, 'billing_address_2' => $a2, 'billing_city' => $city, 'billing_state' => $state, 'billing_postcode' => $pin, 'billing_country' => 'IN' ) as $k => $v ) {
		if ( ! get_user_meta( $uid, $k, true ) ) {
			update_user_meta( $uid, $k, $v );
		}
	}
	d4u_back( 'Sent! A pharmacist will read your prescription and email you the medicines and price. You can follow it here.', 'ok', $order->get_view_order_url() );
}
