<?php
/**
 * The pharmacy dashboard as its own full-screen app (dawa4u.in/pharmacy-dashboard/):
 * no shop header, cart or footer — a sidebar, an overview with today's numbers,
 * the order screens, and a chime when a new order arrives.
 *
 * Forms still post to the handlers in partners.php / dashboards.php.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function d4u_ph_page_id() {
	return (int) get_option( 'd4u_page_pharmacy' );
}

function d4u_ph_url( $tab = '' ) {
	$url = d4u_page_url( 'pharmacy' );
	return $tab && 'home' !== $tab ? add_query_arg( 'tab', $tab, $url ) : $url;
}

/* ------------------------------------------------------------------ data */

/** Orders for this pharmacy (every pharmacy's for the dawa4u team). */
function d4u_ph_query( $uid, $statuses, $args = array() ) {
	$q  = array_merge( array(
		'type'    => 'shop_order', // refunds are orders too in WooCommerce; leave them out
		'status'  => (array) $statuses,
		'limit'   => -1,
		'orderby' => 'date',
		'order'   => 'ASC',
	), $args );
	$mq = isset( $q['meta_query'] ) ? $q['meta_query'] : array(); // phpcs:ignore
	if ( ! d4u_is_boss( $uid ) ) {
		$mq[] = array( 'key' => '_d4u_pharmacy', 'value' => (string) (int) $uid );
	}
	if ( $mq ) {
		$q['meta_query'] = $mq; // phpcs:ignore
	}
	return wc_get_orders( $q );
}

function d4u_ph_counts( $uid ) {
	$c = array();
	foreach ( array( 'rx' => 'd4u-rx', 'pack' => 'processing', 'requests' => 'd4u-request', 'rider' => array( 'd4u-ready', 'd4u-out' ) ) as $k => $st ) {
		$c[ $k ] = count( d4u_ph_query( $uid, $st, array( 'return' => 'ids' ) ) );
	}
	$c['action'] = $c['rx'] + $c['pack'] + $c['requests'];
	return $c;
}

/** Medicine value of an order (what the customer pays for medicines, without delivery, handling or dawaPass). */
function d4u_order_medicine_value( $order ) {
	$sum = 0;
	foreach ( $order->get_items() as $item ) {
		if ( ! d4u_is_pass_product( $item->get_product_id() ) ) {
			$sum += (float) $item->get_subtotal();
		}
	}
	return $sum;
}

function d4u_ph_day_start( $which = 'today' ) {
	$d = new DateTime( 'month' === $which ? 'first day of this month 00:00' : 'today', wp_timezone() );
	return $d->getTimestamp();
}

/** Orders taken and medicine value since a time (orders that went ahead, not cancelled or waiting). */
function d4u_ph_sales( $uid, $from ) {
	$orders = d4u_ph_query( $uid, array( 'processing', 'd4u-ready', 'd4u-out', 'completed' ), array( 'date_created' => '>=' . (int) $from ) );
	$sum    = 0;
	foreach ( $orders as $o ) {
		$sum += d4u_order_medicine_value( $o );
	}
	return array( count( $orders ), $sum );
}

function d4u_ph_delivered_since( $uid, $from ) {
	return count( d4u_ph_query( $uid, 'completed', array(
		'return'     => 'ids',
		'meta_query' => array( array( 'key' => '_d4u_delivered_at', 'value' => (int) $from, 'compare' => '>=', 'type' => 'NUMERIC' ) ), // phpcs:ignore
	) ) );
}

/* ------------------------------------------------------------------ live counts for the chime (polled every 20 s) */

add_action( 'wc_ajax_d4u_ph_counts', function () {
	nocache_headers();
	$uid = get_current_user_id();
	if ( ! $uid || ! ( d4u_is_boss( $uid ) || ( d4u_is_pharmacy( $uid ) && 'approved' === d4u_status( $uid ) ) ) ) {
		wp_send_json_error( null, 403 );
	}
	wp_send_json_success( d4u_ph_counts( $uid ) );
} );

/* ------------------------------------------------------------------ pharmacy accounts go to their dashboard, not My account */

add_action( 'template_redirect', function () {
	if ( ! function_exists( 'is_account_page' ) || ! is_account_page() || is_wc_endpoint_url() || ! is_user_logged_in() ) {
		return;
	}
	$u = wp_get_current_user();
	if ( d4u_is_pharmacy( $u->ID ) && ! d4u_is_boss( $u->ID ) ) {
		wp_safe_redirect( d4u_ph_url() );
		exit;
	}
}, 15 );

/* ------------------------------------------------------------------ render the app instead of the theme page */

add_action( 'template_redirect', function () {
	$id = d4u_ph_page_id();
	if ( ! $id || ! is_page( $id ) ) {
		return;
	}
	nocache_headers();
	header( 'Content-Type: text/html; charset=' . get_option( 'blog_charset' ) );
	echo d4u_ph_app(); // phpcs:ignore -- built from escaped parts
	exit;
}, 20 );

function d4u_ph_icon( $name ) {
	$p = array(
		'home'     => '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
		'rx'       => '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3"/><path d="m9 14 2 2 4-4"/>',
		'pack'     => '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5"/><path d="M12 12v9"/>',
		'requests' => '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/>',
		'rider'    => '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h4l3-6h4l1 6"/><path d="M13 7h3"/>',
		'history'  => '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
		'trend'    => '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
		'pill'     => '<path d="m10.5 20.5-7-7a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"/><path d="m8.5 8.5 7 7"/>',
		'store'    => '<path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
		'logout'   => '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
		'theme'    => '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
		'refresh'  => '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
		'site'     => '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
		'arrow'    => '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
		'plug'     => '<path d="M9 2v5M15 2v5"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
	);
	return '<svg class="d4p-i" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . ( isset( $p[ $name ] ) ? $p[ $name ] : '' ) . '</svg>';
}

function d4u_ph_logo( $size = 34 ) {
	$s = (int) $size;
	return '<svg width="' . $s . '" height="' . $s . '" viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(45 64 58)" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"><path d="M39 58 V38 A25 25 0 0 1 89 38 V58 Z" fill="#166534"/><path d="M39 58 H89 V78 A25 25 0 0 1 39 78 Z" fill="#C9930A"/></g></svg>';
}

function d4u_ph_head( $title ) {
	$theme = "(function(){var k='d4u-theme',m='auto';try{m=localStorage.getItem(k)||'auto'}catch(e){}var l=m==='light'||(m==='auto'&&window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches);document.documentElement.setAttribute('data-theme',l?'light':'dark');document.documentElement.setAttribute('data-theme-mode',m)})();";
	$out   = '<!doctype html><html lang="en" data-theme="dark"><head><meta charset="' . esc_attr( get_option( 'blog_charset' ) ) . '">';
	$out  .= '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex, nofollow">';
	$out  .= '<title>' . esc_html( $title ) . '</title><meta name="theme-color" content="#0B1708">';
	$out  .= '<link rel="icon" href="' . esc_url( get_template_directory_uri() . '/icon.svg' ) . '" type="image/svg+xml">';
	$out  .= '<script>' . $theme . '</script>';
	$out  .= '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
	$out  .= '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap">';
	$out  .= '<link rel="stylesheet" href="' . esc_url( D4U_URL . 'assets/core.css?ver=' . D4U_VER ) . '">';
	$out  .= '<link rel="stylesheet" href="' . esc_url( D4U_URL . 'assets/pharmacy.css?ver=' . D4U_VER ) . '">';
	return $out . '</head>';
}

function d4u_ph_app() {
	$uid  = get_current_user_id();
	$boss = $uid && d4u_is_boss( $uid );
	$ok   = $boss || ( $uid && d4u_is_pharmacy( $uid ) && 'approved' === d4u_status( $uid ) );

	if ( ! $ok ) {
		list( , $html ) = d4u_gate( 'd4u_pharmacy', 'pharmacy' );
		$out  = d4u_ph_head( 'Pharmacy partner · dawa4u' ) . '<body class="d4p d4p--auth">';
		$out .= '<main class="d4p-auth"><div class="d4p-auth__box">';
		$out .= '<div class="d4p-auth__brand">' . d4u_ph_logo( 46 ) . '<div><strong>dawa<b>4u</b></strong><span>Pharmacy partner</span></div></div>';
		$out .= '<p class="d4p-auth__lead">Prescriptions to check, orders to pack and your sales — all in one place.</p>';
		$out .= '<div class="d4u-dash">' . $html . '</div>';
		$out .= '<p class="d4p-auth__foot"><a href="' . esc_url( home_url( '/' ) ) . '">← dawa4u.in</a> · <button type="button" class="d4p-link d4p-theme">Light / dark</button></p>';
		$out .= '</div></main>' . d4u_ph_script( array() ) . '</body></html>';
		return $out;
	}

	$tab   = isset( $_GET['tab'] ) ? sanitize_key( $_GET['tab'] ) : 'home'; // phpcs:ignore
	$tabs  = array( 'home', 'rx', 'pack', 'requests', 'rider', 'history', 'medicines', 'restock', 'connect', 'profile' );
	$tab   = in_array( $tab, $tabs, true ) ? $tab : 'home';
	$count = d4u_ph_counts( $uid );
	$title = ( $count['action'] ? '(' . $count['action'] . ') ' : '' ) . 'Pharmacy · dawa4u';

	$nav = array(
		'home'      => array( 'Overview', 'home', 0 ),
		'rx'        => array( 'Check prescriptions', 'rx', $count['rx'] ),
		'pack'      => array( 'To pack', 'pack', $count['pack'] ),
		'requests'  => array( 'Prescription requests', 'requests', $count['requests'] ),
		'rider'     => array( 'With the rider', 'rider', $count['rider'] ),
		'history'   => array( 'Order history', 'history', 0 ),
		'medicines' => array( 'Medicine list', 'pill', 0 ),
		'restock'   => array( 'Restock & expiry', 'trend', 0 ),
		'connect'   => array( 'Billing software', 'plug', 0 ),
		'profile'   => array( $boss ? 'Partners' : 'Shop details', 'store', 0 ),
	);

	$out  = d4u_ph_head( $title ) . '<body class="d4p" data-counts="' . esc_attr( wp_json_encode( $count ) ) . '">';
	$out .= '<div class="d4p-app"><aside class="d4p-side">';
	$out .= '<a class="d4p-brand" href="' . esc_url( d4u_ph_url() ) . '">' . d4u_ph_logo( 32 ) . '<span><strong>dawa<b>4u</b></strong><small>Pharmacy</small></span></a>';
	$out .= '<nav class="d4p-nav" aria-label="Dashboard">';
	foreach ( $nav as $k => $n ) {
		$badge = $n[2] ? '<span class="d4p-badge" data-count="' . esc_attr( $k ) . '">' . (int) $n[2] . '</span>' : '<span class="d4p-badge" data-count="' . esc_attr( $k ) . '" hidden></span>';
		$href  = ( 'profile' === $k && $boss ) ? admin_url( 'admin.php?page=d4u-partners' ) : d4u_ph_url( $k );
		$out  .= '<a class="' . ( $k === $tab ? 'on' : '' ) . '" href="' . esc_url( $href ) . '"' . ( $k === $tab ? ' aria-current="page"' : '' ) . '>' . d4u_ph_icon( $n[1] ) . '<span>' . esc_html( $n[0] ) . '</span>' . ( in_array( $k, array( 'rx', 'pack', 'requests', 'rider' ), true ) ? $badge : '' ) . '</a>';
	}
	$out .= '</nav><div class="d4p-side__foot">';
	$out .= '<button type="button" class="d4p-sidebtn d4p-theme">' . d4u_ph_icon( 'theme' ) . '<span>Light / dark</span></button>';
	$out .= '<a class="d4p-sidebtn" href="' . esc_url( home_url( '/' ) ) . '">' . d4u_ph_icon( 'site' ) . '<span>dawa4u.in</span></a>';
	$out .= '<a class="d4p-sidebtn" href="' . esc_url( wp_logout_url( d4u_ph_url() ) ) . '">' . d4u_ph_icon( 'logout' ) . '<span>Log out</span></a>';
	$out .= '</div></aside>';

	$out .= '<div class="d4p-main">' . d4u_ph_topbar( $uid, $boss );
	$out .= '<div class="d4p-new" id="d4p-new" role="status" hidden><span id="d4p-new-text">New order</span><button type="button" class="d4u-btn" id="d4p-new-go">Show it</button></div>';
	$out .= d4u_flash_html();
	$fn   = 'd4u_ph_view_' . $tab;
	$out .= '<div class="d4p-view">' . call_user_func( $fn, $uid, $boss, $count ) . '</div>';
	$out .= '</div></div>' . d4u_ph_script( $count ) . '</body></html>';
	return $out;
}

function d4u_ph_topbar( $uid, $boss ) {
	$out = '<header class="d4p-top"><div class="d4p-top__who">';
	if ( $boss ) {
		$out .= '<h1>All pharmacies</h1><p>You are viewing as the dawa4u team: every pharmacy’s orders, and you can act on them.</p>';
	} else {
		$pins = d4u_pins( $uid );
		$out .= '<h1>' . esc_html( d4u_partner_name( $uid ) ) . '</h1>';
		$out .= '<p>' . ( $pins ? 'Delivers to ' . esc_html( implode( ', ', $pins ) ) : '<a href="' . esc_url( d4u_ph_url( 'profile' ) ) . '">Add the PIN codes you deliver to</a> — no orders reach you until you do' ) . '</p>';
	}
	$out .= '</div><div class="d4p-top__act">';
	$out .= '<a class="d4p-iconbtn" href="' . esc_url( remove_query_arg( 'd4u_flash' ) ) . '" title="Refresh" aria-label="Refresh">' . d4u_ph_icon( 'refresh' ) . '</a>';
	if ( ! $boss ) {
		$open  = 'yes' === get_user_meta( $uid, 'd4u_open', true );
		$out  .= d4u_form_open( 'ph_open', 'd4u-inline' ) . '<button class="d4u-switch ' . ( $open ? 'is-on' : '' ) . '" type="submit">' . ( $open ? 'Open — taking orders' : 'Closed — tap to open' ) . '</button></form>';
	}
	return $out . '</div></header>';
}

function d4u_ph_script( $count ) {
	$cfg = array(
		'poll'   => $count ? WC_AJAX::get_endpoint( 'd4u_ph_counts' ) : '',
		'counts' => $count ? $count : null,
		'urls'   => array(
			'rx'       => d4u_ph_url( 'rx' ),
			'pack'     => d4u_ph_url( 'pack' ),
			'requests' => d4u_ph_url( 'requests' ),
		),
	);
	return '<script>window.d4uPh=' . wp_json_encode( $cfg ) . ';</script><script src="' . esc_url( D4U_URL . 'assets/pharmacy.js?ver=' . D4U_VER ) . '"></script>';
}

function d4u_ph_empty( $icon, $title, $text ) {
	return '<div class="d4p-empty">' . d4u_ph_icon( $icon ) . '<strong>' . esc_html( $title ) . '</strong><span>' . esc_html( $text ) . '</span></div>';
}

function d4u_ph_view_head( $title, $text = '' ) {
	return '<div class="d4p-vhead"><h2>' . esc_html( $title ) . '</h2>' . ( $text ? '<p>' . esc_html( $text ) . '</p>' : '' ) . '</div>';
}

/* ------------------------------------------------------------------ views */

function d4u_ph_view_home( $uid, $boss, $count ) {
	$h     = (int) current_time( 'G' );
	$hello = $h < 12 ? 'Good morning' : ( $h < 17 ? 'Good afternoon' : 'Good evening' );
	$u     = wp_get_current_user();
	$name  = $u->first_name ? $u->first_name : $u->display_name;
	$out   = '<p class="d4p-hello">' . esc_html( $hello . ', ' . $name ) . '</p>';

	if ( ! $boss && 'yes' !== get_user_meta( $uid, 'd4u_open', true ) ) {
		$out .= '<div class="d4u-flash d4u-flash--warn">You are <strong>closed</strong>, so new orders go to another pharmacy near the customer. Tap <strong>Closed — tap to open</strong> at the top when you are ready.</div>';
	}

	$tiles = array(
		'rx'       => array( 'Check prescriptions', 'Approve or reject' ),
		'pack'     => array( 'To pack', 'Approved and paid' ),
		'requests' => array( 'Prescription requests', 'Add medicines and price' ),
		'rider'    => array( 'With the rider', 'Packed or on the way' ),
	);
	$out .= '<h2 class="d4p-h">Needs you now</h2><div class="d4p-tiles">';
	foreach ( $tiles as $k => $t ) {
		$n    = (int) $count[ $k ];
		$hot  = $n && 'rider' !== $k;
		$out .= '<a class="d4p-tile' . ( $hot ? ' is-hot' : '' ) . '" href="' . esc_url( d4u_ph_url( $k ) ) . '"><span class="d4p-tile__label">' . esc_html( $t[0] ) . '</span><strong data-count="' . esc_attr( $k ) . '-tile">' . $n . '</strong><span class="d4p-tile__sub">' . esc_html( $t[1] ) . d4u_ph_icon( 'arrow' ) . '</span></a>';
	}
	$out .= '</div>';

	list( $today_n, $today_v ) = d4u_ph_sales( $uid, d4u_ph_day_start() );
	list( $month_n, $month_v ) = d4u_ph_sales( $uid, d4u_ph_day_start( 'month' ) );
	$done_today                = d4u_ph_delivered_since( $uid, d4u_ph_day_start() );
	$out                      .= '<h2 class="d4p-h">Today</h2><div class="d4p-stats">';
	$out                      .= '<div class="d4p-stat"><span>Orders today</span><strong>' . (int) $today_n . '</strong></div>';
	$out                      .= '<div class="d4p-stat"><span>Medicine sales today</span><strong>' . esc_html( d4u_inr( $today_v ) ) . '</strong></div>';
	$out                      .= '<div class="d4p-stat"><span>Delivered today</span><strong>' . (int) $done_today . '</strong></div>';
	$pack_avg                  = $boss ? null : d4u_avg_pack_minutes( $uid, d4u_ph_day_start() );
	if ( null !== $pack_avg ) {
		$out .= '<div class="d4p-stat"><span>Average packing time today</span><strong>' . (int) $pack_avg . ' min</strong><em>aim for under ' . (int) d4u_opt( 'pack_min' ) . ' min</em></div>';
	}
	$out                      .= '<div class="d4p-stat"><span>' . esc_html( date_i18n( 'F' ) ) . ' so far</span><strong>' . esc_html( d4u_inr( $month_v ) ) . '</strong><em>' . (int) $month_n . ' orders</em></div>';
	$out                      .= '</div>';

	$next = array_merge(
		d4u_ph_query( $uid, 'd4u-rx', array( 'limit' => 6 ) ),
		d4u_ph_query( $uid, 'd4u-request', array( 'limit' => 6 ) ),
		d4u_ph_query( $uid, 'processing', array( 'limit' => 6 ) )
	);
	usort( $next, function ( $a, $b ) {
		return $a->get_date_created()->getTimestamp() - $b->get_date_created()->getTimestamp();
	} );
	$out .= '<h2 class="d4p-h">Up next</h2>';
	if ( ! $next ) {
		return $out . d4u_ph_empty( 'pack', 'All caught up', 'New orders will appear here — you will hear a chime.' );
	}
	$what = array(
		'd4u-rx'      => array( 'Check prescription', 'rx' ),
		'd4u-request' => array( 'Add medicines', 'requests' ),
		'processing'  => array( 'Pack', 'pack' ),
	);
	$out .= '<div class="d4p-list">';
	foreach ( array_slice( $next, 0, 8 ) as $o ) {
		$w     = $what[ $o->get_status() ];
		$items = $o->get_item_count();
		$out  .= '<a class="d4p-row" href="' . esc_url( d4u_ph_url( $w[1] ) ) . '"><span class="d4p-chip d4p-chip--' . esc_attr( $w[1] ) . '">' . esc_html( $w[0] ) . '</span>';
		$out  .= '<span class="d4p-row__main"><strong>#' . esc_html( $o->get_order_number() ) . ' · ' . esc_html( $o->get_billing_first_name() ) . '</strong><small>' . esc_html( $items ? sprintf( _n( '%d item', '%d items', $items, 'dawa4u' ), $items ) . ' · ' . wp_strip_all_tags( wc_price( $o->get_total() ) ) : 'Prescription only' ) . ' · PIN ' . esc_html( d4u_order_pin( $o ) ) . '</small></span>';
		$out  .= '<span class="d4p-row__age">' . esc_html( d4u_ago( $o ) ) . '</span>' . d4u_ph_icon( 'arrow' ) . '</a>';
	}
	return $out . '</div>';
}

function d4u_ph_cards( $orders, $render ) {
	$out = '<div class="d4p-cards">';
	foreach ( $orders as $o ) {
		$out .= call_user_func( $render, $o );
	}
	return $out . '</div>';
}

function d4u_ph_view_rx( $uid ) {
	$orders = d4u_ph_query( $uid, 'd4u-rx' );
	$out    = d4u_ph_view_head( 'Check prescriptions', 'Open each prescription. If it is valid and matches the medicines, approve it and the order moves to “To pack”. If not, reject it with a reason — the customer is told and refunded.' );
	if ( ! $orders ) {
		return $out . d4u_ph_empty( 'rx', 'No prescriptions to check', 'Orders with prescription medicines will appear here.' );
	}
	return $out . d4u_ph_cards( $orders, function ( $o ) {
		return d4u_ph_card( $o, 'rx' );
	} );
}

function d4u_ph_view_pack( $uid ) {
	$orders = d4u_ph_query( $uid, 'processing' );
	$out    = d4u_ph_view_head( 'To pack', 'Pack the medicines, then tap “Packed”. Riders nearby are told right away.' );
	if ( ! $orders ) {
		return $out . d4u_ph_empty( 'pack', 'Nothing to pack', 'Approved and paid orders will appear here.' );
	}
	return $out . d4u_ph_cards( $orders, function ( $o ) {
		return d4u_ph_card( $o, 'pack' );
	} );
}

function d4u_ph_view_requests( $uid ) {
	$orders = d4u_ph_query( $uid, 'd4u-request' );
	$out    = d4u_ph_view_head( 'Prescription requests', 'Customers who sent only a prescription. Read it, choose the medicines and send — the customer gets an email with the price, pays, and the order comes to “To pack”.' );
	if ( ! $orders ) {
		return $out . d4u_ph_empty( 'requests', 'No prescription requests', 'Prescriptions sent from the Upload prescription page will appear here.' );
	}
	return $out . d4u_ph_cards( $orders, 'd4u_ph_request_card' );
}

function d4u_ph_view_rider( $uid ) {
	$orders = d4u_ph_query( $uid, array( 'd4u-ready', 'd4u-out' ) );
	$out    = d4u_ph_view_head( 'With the rider', 'Packed orders waiting for pickup, and orders on the way.' );
	if ( ! $orders ) {
		return $out . d4u_ph_empty( 'rider', 'Nothing out right now', 'Orders you mark as packed show here until they are delivered.' );
	}
	$out .= '<div class="d4p-tablewrap"><table class="d4p-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Rider</th><th class="num">Total</th></tr></thead><tbody>';
	foreach ( $orders as $o ) {
		$r     = (int) $o->get_meta( '_d4u_rider' );
		$phone = $r ? get_user_meta( $r, 'd4u_phone', true ) : '';
		$out  .= '<tr><td>#' . esc_html( $o->get_order_number() ) . '<small>' . esc_html( d4u_ago( $o ) ) . '</small></td><td>' . esc_html( $o->get_billing_first_name() ) . '<small>PIN ' . esc_html( d4u_order_pin( $o ) ) . '</small></td>';
		$out  .= '<td><span class="d4p-chip d4p-chip--' . ( $o->has_status( 'd4u-out' ) ? 'out' : 'ready' ) . '">' . esc_html( $o->has_status( 'd4u-out' ) ? 'On the way' : 'Waiting for pickup' ) . '</span></td>';
		$out  .= '<td>' . ( $r ? esc_html( d4u_partner_name( $r ) ) . ( $phone ? '<small><a href="tel:' . esc_attr( preg_replace( '/[^0-9+]/', '', $phone ) ) . '">' . esc_html( $phone ) . '</a></small>' : '' ) : '<span class="d4p-mute">Not taken yet</span>' ) . '</td>';
		$out  .= '<td class="num">' . wp_kses_post( wc_price( $o->get_total() ) ) . '<small>' . esc_html( 'cod' === $o->get_payment_method() ? 'Cash on delivery' : 'Paid' ) . '</small></td></tr>';
	}
	return $out . '</tbody></table></div>';
}

function d4u_ph_view_history( $uid ) {
	list( $month_n, $month_v ) = d4u_ph_sales( $uid, d4u_ph_day_start( 'month' ) );
	$orders                    = d4u_ph_query( $uid, array( 'completed', 'cancelled' ), array( 'limit' => 50, 'order' => 'DESC' ) );
	$out                       = d4u_ph_view_head( 'Order history', 'Your last 50 delivered and cancelled orders.' );
	$out                      .= '<div class="d4p-stats d4p-stats--2"><div class="d4p-stat"><span>' . esc_html( date_i18n( 'F' ) ) . ' orders</span><strong>' . (int) $month_n . '</strong></div><div class="d4p-stat"><span>' . esc_html( date_i18n( 'F' ) ) . ' medicine sales</span><strong>' . esc_html( d4u_inr( $month_v ) ) . '</strong></div></div>';
	if ( ! $orders ) {
		return $out . d4u_ph_empty( 'history', 'No finished orders yet', 'Delivered and cancelled orders will be listed here.' );
	}
	$out .= '<div class="d4p-tablewrap"><table class="d4p-table"><thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Status</th><th class="num">Medicines</th></tr></thead><tbody>';
	foreach ( $orders as $o ) {
		$d    = $o->get_date_created();
		$out .= '<tr><td>' . esc_html( $d ? $d->date_i18n( 'j M, g:i a' ) : '' ) . '</td><td>#' . esc_html( $o->get_order_number() ) . '</td><td>' . esc_html( $o->get_billing_first_name() ) . '</td>';
		$out .= '<td><span class="d4p-chip d4p-chip--' . ( $o->has_status( 'completed' ) ? 'done' : 'cancel' ) . '">' . esc_html( $o->has_status( 'completed' ) ? 'Delivered' : 'Cancelled' ) . '</span></td>';
		$out .= '<td class="num">' . esc_html( d4u_inr( d4u_order_medicine_value( $o ) ) ) . '</td></tr>';
	}
	return $out . '</tbody></table></div>';
}

function d4u_ph_view_medicines( $uid = 0, $boss = false ) {
	$stock = $boss ? array() : d4u_stock( $uid );
	$show  = (bool) $stock;
	$out   = d4u_ph_view_head( 'Medicine list', 'Everything customers can order, at MRP. Medicines marked Rx need a prescription that you check. To add a medicine or change a price, write to the dawa4u team.' );
	if ( ! $boss && ! $show ) {
		$out .= '<p class="d4u-small d4p-mute">Upload your stock from Marg or any billing software in <a href="' . esc_url( d4u_ph_url( 'connect' ) ) . '">Billing software</a> to see it here.</p>';
	}
	$terms = get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => true, 'meta_key' => 'order', 'orderby' => 'meta_value_num' ) ); // phpcs:ignore
	foreach ( is_array( $terms ) ? $terms : array() as $t ) {
		$prods = wc_get_products( array( 'status' => 'publish', 'limit' => 300, 'category' => array( $t->slug ), 'orderby' => 'title', 'order' => 'ASC' ) );
		if ( ! $prods ) {
			continue;
		}
		$out .= '<h2 class="d4p-h">' . esc_html( $t->name ) . ' <span class="d4p-mute">' . count( $prods ) . '</span></h2><div class="d4p-tablewrap"><table class="d4p-table"><thead><tr><th>Medicine</th><th>Contains · pack</th><th class="num">MRP</th>' . ( $show ? '<th class="num">Your stock</th>' : '' ) . '</tr></thead><tbody>';
		foreach ( $prods as $p ) {
			$line = trim( get_post_meta( $p->get_id(), '_d4u_salt', true ) . ' · ' . get_post_meta( $p->get_id(), '_d4u_pack', true ), ' ·' );
			$out .= '<tr><td><strong>' . esc_html( $p->get_name() ) . '</strong>' . ( d4u_needs_rx( $p ) ? ' <span class="d4u-rx-tag">Rx</span>' : '' ) . '</td><td class="d4p-mute">' . esc_html( $line ) . '</td><td class="num">' . esc_html( d4u_inr( $p->get_price() ) ) . '</td>' . ( $show ? '<td class="num">' . ( isset( $stock[ $p->get_sku() ] ) ? ( $stock[ $p->get_sku() ]['qty'] ? (int) $stock[ $p->get_sku() ]['qty'] : '<span class="d4u-stock is-low">0</span>' ) : '<span class="d4p-mute">—</span>' ) . '</td>' : '' ) . '</tr>';
		}
		$out .= '</tbody></table></div>';
	}
	return $out;
}

function d4u_ph_view_profile( $uid, $boss ) {
	if ( $boss ) {
		return d4u_ph_view_head( 'Partners', 'Approve pharmacies and change their details in WooCommerce → dawa4u partners.' );
	}
	$u    = wp_get_current_user();
	$out  = d4u_ph_view_head( 'Shop details', 'Customers in these PIN codes are sent to you. Keep your phone number right — riders and customers call it.' );
	$out .= '<div class="d4p-narrow">' . d4u_ph_profile_form( $uid );
	$out .= '<div class="d4u-card d4u-card--soft"><p class="d4u-small"><strong>Login email:</strong> ' . esc_html( $u->user_email ) . '</p><p class="d4u-small"><a href="' . esc_url( wp_lostpassword_url( d4u_ph_url() ) ) . '">Change password</a> · <a href="' . esc_url( wp_logout_url( d4u_ph_url() ) ) . '">Log out</a></p></div></div>';
	return $out;
}
