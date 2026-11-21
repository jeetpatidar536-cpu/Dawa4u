<?php
/**
 * dawa4u theme — setup, assets, and first-run page creation.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Where the ordering apps live. Change this one line if the apps move. */
define( 'DAWA4U_APPS', 'https://dawa4u.in/' ); // shop/, app/, pharmacy/, rider/, admin/ live next to WordPress

require_once __DIR__ . '/inc/medicines.php';

function dawa4u_app( $path = '' ) {
	return esc_url( DAWA4U_APPS . ltrim( $path, '/' ) );
}

add_action( 'after_setup_theme', function () {
	add_theme_support( 'title-tag' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'editor-styles' );
	add_editor_style( 'editor.css' );
	register_nav_menus( array(
		'primary' => __( 'Main menu', 'dawa4u' ),
		'footer'  => __( 'Footer menu', 'dawa4u' ),
	) );
} );

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'dawa4u-fonts', 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,600&display=swap', array(), null );
	wp_enqueue_style( 'dawa4u', get_stylesheet_uri(), array( 'dawa4u-fonts' ), wp_get_theme()->get( 'Version' ) );
} );

/** Light / dark mode: decided before the page paints (auto = follows the phone / computer). */
add_action( 'wp_head', function () {
	echo "<script>(function(){var k='d4u-theme',m='auto';try{m=localStorage.getItem(k)||'auto'}catch(e){}var l=m==='light'||(m==='auto'&&window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches);document.documentElement.setAttribute('data-theme',l?'light':'dark');document.documentElement.setAttribute('data-theme-mode',m)})();</script>\n";
}, 0 );

add_action( 'wp_footer', function () {
	?>
<script>
(function () {
  var k = 'd4u-theme', order = ['auto', 'light', 'dark'], root = document.documentElement;
  var icons = {
    auto: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    light: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };
  var media = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  function mode() { try { return localStorage.getItem(k) || 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var m = mode(), light = m === 'light' || (m === 'auto' && media && media.matches);
    root.setAttribute('data-theme', light ? 'light' : 'dark'); root.setAttribute('data-theme-mode', m);
    var labels = { auto: 'Theme: automatic', light: 'Theme: light', dark: 'Theme: dark' };
    document.querySelectorAll('.d4-theme').forEach(function (b) { b.innerHTML = icons[m]; b.title = labels[m]; b.setAttribute('aria-label', labels[m] + ' (tap to change)'); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.d4-theme'); if (!b) return;
    var next = order[(order.indexOf(mode()) + 1) % 3]; try { localStorage.setItem(k, next); } catch (er) {} apply();
  });
  if (media && media.addEventListener) media.addEventListener('change', apply);
  apply();
})();
</script>
	<?php
}, 20 );

add_action( 'wp_head', function () {
	echo '<meta name="theme-color" content="#0B1708">' . "\n";
	echo '<link rel="icon" href="' . esc_url( get_template_directory_uri() . '/icon.svg' ) . '" type="image/svg+xml">' . "\n";
}, 2 );

/** The capsule logo, same as the apps. */
function dawa4u_logo( $size = 34 ) {
	$s = (int) $size;
	return '<svg width="' . $s . '" height="' . $s . '" viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(45 64 58)" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"><path d="M39 58 V38 A25 25 0 0 1 89 38 V58 Z" fill="#166534"/><path d="M39 58 H89 V78 A25 25 0 0 1 39 78 Z" fill="#C9930A"/></g></svg>';
}

/* ------------------------------------------------------------------
 * Block markup helpers (output stays editable in the block editor)
 * ------------------------------------------------------------------ */

function d4b_attrs( $cls ) {
	return $cls ? ' ' . wp_json_encode( array( 'className' => $cls ) ) : '';
}
function d4b_cls( $base, $cls ) {
	return trim( $base . ' ' . $cls );
}
function d4b_h( $text, $level = 2, $cls = '' ) {
	$a = array();
	if ( 2 !== $level ) {
		$a['level'] = $level;
	}
	if ( $cls ) {
		$a['className'] = $cls;
	}
	$json = $a ? ' ' . wp_json_encode( $a ) : '';
	return "<!-- wp:heading{$json} -->\n<h{$level} class=\"" . d4b_cls( 'wp-block-heading', $cls ) . "\">{$text}</h{$level}>\n<!-- /wp:heading -->\n";
}
function d4b_p( $text, $cls = '' ) {
	$c = $cls ? ' class="' . $cls . '"' : '';
	return '<!-- wp:paragraph' . d4b_attrs( $cls ) . " -->\n<p{$c}>{$text}</p>\n<!-- /wp:paragraph -->\n";
}
function d4b_buttons( $items ) {
	$out = "<!-- wp:buttons -->\n<div class=\"wp-block-buttons\">";
	foreach ( $items as $b ) {
		$cls  = isset( $b[2] ) ? $b[2] : '';
		$out .= '<!-- wp:button' . d4b_attrs( $cls ) . " -->\n<div class=\"" . d4b_cls( 'wp-block-button', $cls ) . '"><a class="wp-block-button__link wp-element-button" href="' . esc_url( $b[1] ) . '">' . $b[0] . "</a></div>\n<!-- /wp:button -->";
	}
	return $out . "</div>\n<!-- /wp:buttons -->\n";
}
function d4b_group( $cls, $inner ) {
	$a = wp_json_encode( array( 'className' => $cls, 'layout' => array( 'type' => 'constrained' ) ) );
	return "<!-- wp:group {$a} -->\n<div class=\"wp-block-group {$cls}\">{$inner}</div>\n<!-- /wp:group -->\n";
}
function d4b_cols( $cols, $cls = '' ) {
	$out = '<!-- wp:columns' . d4b_attrs( $cls ) . " -->\n<div class=\"" . d4b_cls( 'wp-block-columns', $cls ) . '">';
	foreach ( $cols as $inner ) {
		$out .= "<!-- wp:column -->\n<div class=\"wp-block-column\">{$inner}</div>\n<!-- /wp:column -->";
	}
	return $out . "</div>\n<!-- /wp:columns -->\n";
}
function d4b_list( $items ) {
	$out = "<!-- wp:list -->\n<ul class=\"wp-block-list\">";
	foreach ( $items as $i ) {
		$out .= "<!-- wp:list-item -->\n<li>{$i}</li>\n<!-- /wp:list-item -->";
	}
	return $out . "</ul>\n<!-- /wp:list -->\n";
}
function d4b_faq( $q, $a ) {
	return "<!-- wp:details -->\n<details class=\"wp-block-details\"><summary>{$q}</summary>" . d4b_p( $a ) . "</details>\n<!-- /wp:details -->\n";
}

/* ------------------------------------------------------------------
 * Page content
 * ------------------------------------------------------------------ */

function dawa4u_pages() {
	$shop = DAWA4U_APPS . 'shop/';
	$app  = DAWA4U_APPS . 'app/';
	$rx   = DAWA4U_APPS . 'shop/#/rx';
	$help = DAWA4U_APPS . 'shop/#/help';
	$ph   = DAWA4U_APPS . 'pharmacy/';
	$rd   = DAWA4U_APPS . 'rider/';

	$pass_benefits = d4b_list( array(
		'<strong>15–20% off</strong> medicines on every order',
		'<strong>Free delivery</strong> on every order',
		'<strong>Priority</strong> — your order is packed and sent first',
		'Lasts 30 days, then renew when you like',
	) );

	$home =
		d4b_group( 'd4-hero',
			d4b_p( 'Licensed pharmacy network · India', 'd4-eyebrow' ) .
			d4b_h( 'Medicines at your door in <em>15 minutes</em>', 1 ) .
			d4b_p( 'Order from licensed partner pharmacies near you, in cities and villages. Every prescription is read by a licensed pharmacist, and a local rider brings your order to your door.', 'd4-lead' ) .
			d4b_buttons( array(
				array( 'Order medicines', $shop, 'd4-gold' ),
				array( 'Upload prescription', $rx ),
				array( 'Get the app', $app, 'is-style-outline' ),
			) )
		) .
		d4b_h( 'Why dawa4u' ) .
		d4b_cols( array(
			d4b_h( 'Read by a pharmacist', 3 ) . d4b_p( 'Every prescription is checked by a licensed pharmacist — a real person — before your medicines are packed.' ),
			d4b_h( 'Fast local delivery', 3 ) . d4b_p( 'A rider from your area picks up from the nearest partner pharmacy and delivers in 10–15 minutes.' ),
			d4b_h( 'Cities and villages', 3 ) . d4b_p( 'We work with licensed pharmacies close to you, so small towns and villages get quick delivery too.' ),
			d4b_h( 'Track it live', 3 ) . d4b_p( 'Follow your order on the map from the pharmacy to your door, and call your rider if you need to.' ),
		), 'd4-features' ) .
		d4b_h( 'How it works' ) .
		d4b_cols( array(
			d4b_p( '1', 'd4-step-no' ) . d4b_h( 'Choose or upload', 3 ) . d4b_p( 'Search for your medicines, or upload a photo of your prescription.' ),
			d4b_p( '2', 'd4-step-no' ) . d4b_h( 'Pharmacist checks', 3 ) . d4b_p( 'A licensed pharmacist verifies your prescription before you pay.' ),
			d4b_p( '3', 'd4-step-no' ) . d4b_h( 'Rider delivers', 3 ) . d4b_p( 'Your nearest partner pharmacy packs the order and a local rider brings it over.' ),
		), 'd4-steps' ) .
		d4b_group( 'd4-pass',
			d4b_p( 'dawaPass', 'd4-eyebrow' ) .
			d4b_p( '₹100<small>/month</small>', 'd4-price' ) .
			$pass_benefits .
			d4b_buttons( array( array( 'Join dawaPass', $shop, 'd4-gold' ), array( 'Learn more', home_url( '/dawapass/' ), 'is-style-outline' ) ) )
		) .
		d4b_group( 'd4-band',
			d4b_h( 'Run a pharmacy, or want to ride with us?' ) .
			d4b_p( 'Licensed pharmacies and local riders can join the dawa4u network.' ) .
			d4b_buttons( array( array( 'Partner with us', home_url( '/partners/' ) ) ) )
		);

	$dawapass =
		d4b_p( 'Save on every order with dawaPass.', 'd4-lead' ) .
		d4b_group( 'd4-pass',
			d4b_p( 'dawaPass', 'd4-eyebrow' ) .
			d4b_p( '₹100<small>/month</small>', 'd4-price' ) .
			$pass_benefits .
			d4b_buttons( array( array( 'Join dawaPass', $shop, 'd4-gold' ) ) )
		) .
		d4b_h( 'Questions' ) .
		d4b_faq( 'How do I join?', 'Add dawaPass to your cart in the dawa4u app or website and pay with your order. Your benefits start straight away.' ) .
		d4b_faq( 'How long does it last?', 'dawaPass lasts 30 days from the day you join.' ) .
		d4b_faq( 'Does it work on prescription medicines?', 'Yes. The discount applies to your order, and every prescription is still checked by a licensed pharmacist.' );

	$partners =
		d4b_p( 'Grow with dawa4u. We connect nearby customers with licensed pharmacies, and local riders deliver in minutes.', 'd4-lead' ) .
		d4b_cols( array(
			d4b_h( 'For pharmacies', 3 ) .
			d4b_list( array(
				'Get orders from customers in your area',
				'See prescriptions in your dashboard and approve them',
				'Keep your stock up to date in one place',
				'Have your drug licence number ready to sign up',
			) ) .
			d4b_buttons( array( array( 'Register your pharmacy', $ph ) ) ),
			d4b_h( 'For riders', 3 ) .
			d4b_list( array(
				'Deliver in your own area',
				'Pick up from partner pharmacies near you',
				'The rider app works in English and Hindi',
				'You need a bike or scooter and a smartphone',
			) ) .
			d4b_buttons( array( array( 'Become a rider', $rd ) ) ),
		), 'd4-features' ) .
		d4b_p( 'After you register, the dawa4u team reviews your details and gets in touch.', 'd4-note' );

	$about =
		d4b_p( 'dawa4u connects people in cities and villages across India with licensed partner pharmacies nearby, and a local rider delivers in 10–15 minutes.', 'd4-lead' ) .
		d4b_p( 'Every prescription is read by a licensed pharmacist — never by a machine. Medicines that need a prescription are only dispensed after it has been checked.' ) .
		d4b_p( 'dawaPass members pay ₹100 a month for 15–20% off medicines, free delivery and priority fulfilment.' ) .
		d4b_buttons( array( array( 'Start shopping', $shop, 'd4-gold' ) ) );

	$helppage =
		d4b_faq( 'Where is my order?', 'Open Orders in the app to see the live tracker and call your rider.' ) .
		d4b_faq( 'My medicine needs a prescription', 'Upload a photo of it. A licensed pharmacist verifies it before you pay.' ) .
		d4b_faq( 'How does dawaPass work?', '₹100 a month for 15–20% off, free delivery and priority fulfilment. It lasts 30 days.' ) .
		d4b_faq( 'Refunds', 'If an order is cancelled after you paid online, the money goes back to your original payment method in 3–5 working days.' ) .
		d4b_group( 'd4-band',
			d4b_h( 'Write to us' ) .
			d4b_p( 'Log in to the dawa4u app or website and open Help &amp; support to send us a message. You will see our reply there.' ) .
			d4b_buttons( array( array( 'Open Help &amp; support', $help ) ) )
		);

	$refunds =
		d4b_h( 'Cancelling an order' ) .
		d4b_p( 'If your order can still be cancelled, you will see a Cancel button on it in Orders in the app or website.' ) .
		d4b_h( 'Refunds' ) .
		d4b_p( 'If an order is cancelled after you paid online — by you, by the pharmacy, or by dawa4u — the money goes back to your original payment method in 3–5 working days.' ) .
		d4b_p( 'If something is wrong with your refund, write to us from Help &amp; support in the app and we will look into it.' );

	return array(
		'home'      => array( 'Home', $home, 0 ),
		'dawapass'  => array( 'dawaPass', $dawapass, 1 ),
		'partners'  => array( 'Partners', $partners, 2 ),
		'about'     => array( 'About', $about, 3 ),
		'help'      => array( 'Help', $helppage, 4 ),
		'refunds'   => array( 'Refunds & cancellations', $refunds, 5 ),
	);
}

/* ------------------------------------------------------------------
 * First run: create pages, menus and settings once.
 * ------------------------------------------------------------------ */

function dawa4u_setup_site() {
	if ( get_option( 'dawa4u_setup_v1' ) ) {
		return;
	}
	update_option( 'dawa4u_setup_v1', time() ); // set first so a slow request can't run it twice

	$ids = array();
	foreach ( dawa4u_pages() as $slug => $p ) {
		$existing = get_page_by_path( $slug, OBJECT, 'page' );
		if ( $existing ) {
			$ids[ $slug ] = $existing->ID;
			continue;
		}
		$ids[ $slug ] = wp_insert_post( array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => $p[0],
			'post_name'    => $slug,
			'post_content' => $p[1],
			'menu_order'   => $p[2],
		) );
	}

	// Home page as the front page.
	if ( ! empty( $ids['home'] ) && ! is_wp_error( $ids['home'] ) ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $ids['home'] );
	}

	// Move WordPress's sample content to the bin (recoverable from Trash).
	$sample = get_page_by_path( 'sample-page', OBJECT, 'page' );
	if ( $sample ) {
		wp_trash_post( $sample->ID );
	}
	$hello = get_page_by_path( 'hello-world', OBJECT, 'post' );
	if ( $hello ) {
		wp_trash_post( $hello->ID );
	}

	update_option( 'blogname', 'dawa4u' );
	update_option( 'blogdescription', 'Medicines at your door in 15 minutes' );

	// Menus.
	$menus = array(
		'primary' => array( 'Main menu', array( 'dawapass', 'partners', 'about', 'help' ) ),
		'footer'  => array( 'Footer menu', array( 'about', 'dawapass', 'partners', 'help', 'refunds' ) ),
	);
	$locations = get_theme_mod( 'nav_menu_locations', array() );
	foreach ( $menus as $loc => $m ) {
		$menu_id = wp_create_nav_menu( $m[0] );
		if ( is_wp_error( $menu_id ) ) {
			$obj     = wp_get_nav_menu_object( $m[0] );
			$menu_id = $obj ? $obj->term_id : 0;
		} else {
			foreach ( $m[1] as $slug ) {
				if ( empty( $ids[ $slug ] ) || is_wp_error( $ids[ $slug ] ) ) {
					continue;
				}
				wp_update_nav_menu_item( $menu_id, 0, array(
					'menu-item-object-id' => $ids[ $slug ],
					'menu-item-object'    => 'page',
					'menu-item-type'      => 'post_type',
					'menu-item-status'    => 'publish',
				) );
			}
		}
		if ( $menu_id ) {
			$locations[ $loc ] = $menu_id;
		}
	}
	set_theme_mod( 'nav_menu_locations', $locations );

	flush_rewrite_rules( false );
}
add_action( 'after_switch_theme', 'dawa4u_setup_site' );
add_action( 'init', 'dawa4u_setup_site', 99 );

/** v2: Medicines page (live list from the apps), in both menus, and a short list on the home page. */
function dawa4u_setup_v2() {
	if ( get_option( 'dawa4u_setup_v2' ) ) {
		return;
	}
	update_option( 'dawa4u_setup_v2', time() );

	$page = get_page_by_path( 'medicines', OBJECT, 'page' );
	if ( $page ) {
		$id = $page->ID;
	} else {
		$id = wp_insert_post( array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => 'Medicines',
			'post_name'    => 'medicines',
			'menu_order'   => 1,
			'post_content' => d4b_p( 'Live prices and stock from our licensed partner pharmacies. Enter your PIN, add what you need, and check out in the dawa4u shop.', 'd4-lead' ) .
				"<!-- wp:shortcode -->\n[dawa4u_medicines]\n<!-- /wp:shortcode -->\n",
		) );
	}
	if ( ! $id || is_wp_error( $id ) ) {
		return;
	}

	$locations = get_theme_mod( 'nav_menu_locations', array() );
	foreach ( array( 'primary', 'footer' ) as $loc ) {
		if ( empty( $locations[ $loc ] ) ) {
			continue;
		}
		$have = false;
		foreach ( (array) wp_get_nav_menu_items( $locations[ $loc ] ) as $item ) {
			if ( (int) $item->object_id === (int) $id ) {
				$have = true;
			}
		}
		if ( ! $have ) {
			wp_update_nav_menu_item( $locations[ $loc ], 0, array(
				'menu-item-object-id' => $id,
				'menu-item-object'    => 'page',
				'menu-item-type'      => 'post_type',
				'menu-item-status'    => 'publish',
				'menu-item-position'  => 1,
			) );
			// put it first
			$items = wp_get_nav_menu_items( $locations[ $loc ] );
			$order = 2;
			foreach ( (array) $items as $item ) {
				$pos = ( (int) $item->object_id === (int) $id ) ? 1 : $order++;
				update_post_meta( $item->ID, '_menu_item_menu_order', $pos );
				wp_update_post( array( 'ID' => $item->ID, 'menu_order' => $pos ) );
			}
		}
	}

	// Short list on the home page, just before the dawaPass box (only if the page doesn't have one yet).
	$home = (int) get_option( 'page_on_front' );
	if ( $home ) {
		$post = get_post( $home );
		if ( $post && false === strpos( $post->post_content, 'dawa4u_medicines' ) ) {
			$block  = d4b_h( 'Popular medicines' ) . "<!-- wp:shortcode -->\n[dawa4u_medicines limit=\"8\"]\n<!-- /wp:shortcode -->\n";
			$marker = '<!-- wp:group {"className":"d4-pass"';
			$pos    = strpos( $post->post_content, $marker );
			$new    = false === $pos ? $post->post_content . $block : substr( $post->post_content, 0, $pos ) . $block . substr( $post->post_content, $pos );
			wp_update_post( array( 'ID' => $home, 'post_content' => $new ) );
		}
	}
}
add_action( 'init', 'dawa4u_setup_v2', 100 );

/** Pages made before the apps moved to dawa4u.in still hold the old github.io links: point them here. */
add_filter( 'the_content', function ( $html ) {
	return str_replace( 'https://jeetpatidar536-cpu.github.io/Dawa4u/', DAWA4U_APPS, $html );
}, 5 );

/** Fallback menu if none is assigned. */
function dawa4u_fallback_menu() {
	echo '<ul>';
	foreach ( array( 'dawapass' => 'dawaPass', 'partners' => 'Partners', 'about' => 'About', 'help' => 'Help' ) as $slug => $label ) {
		echo '<li><a href="' . esc_url( home_url( '/' . $slug . '/' ) ) . '">' . esc_html( $label ) . '</a></li>';
	}
	echo '</ul>';
}
