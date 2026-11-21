<?php
/**
 * [dawa4u_medicines] — the medicine list from the dawa4u apps (Supabase), on the WordPress site.
 * Same data the pharmacies manage in their app: names, MRP, and — once the visitor enters a PIN —
 * the price and stock at the partner pharmacy that delivers there. "Add" puts items straight into
 * the dawa4u shop cart (same site, same browser storage), then "Go to cart" opens /shop/#/cart.
 *
 * [dawa4u_medicines]                 full list with search, categories and PIN
 * [dawa4u_medicines limit="8"]       short list (e.g. on the home page) with a "See all" link
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function dawa4u_cats() {
	return array(
		'fever' => array( 'Rx', 'Fever & pain' ),
		'bp'    => array( 'BP', 'Diabetes & BP' ),
		'vit'   => array( 'Vit', 'Vitamins' ),
		'baby'  => array( 'Baby', 'Baby care' ),
		'skin'  => array( 'Skin', 'Skin care' ),
		'kit'   => array( 'Kit', 'First aid' ),
		'ors'   => array( 'ORS', 'Stomach care' ),
		'dev'   => array( 'Dev', 'Health devices' ),
	);
}

/** Supabase URL + public (anon) key, read from the apps' own config file so there is one place to change them. */
function dawa4u_supabase() {
	static $c = null;
	if ( null !== $c ) {
		return $c;
	}
	$c   = array( 'url' => '', 'key' => '' );
	$src = @file_get_contents( ABSPATH . 'common/config.js' ); // phpcs:ignore
	if ( $src ) {
		if ( preg_match( "/SUPABASE_URL:\s*'([^']+)'/", $src, $m ) ) {
			$c['url'] = $m[1];
		}
		if ( preg_match( "/SUPABASE_ANON_KEY:\s*'([^']+)'/", $src, $m ) ) {
			$c['key'] = $m[1];
		}
	}
	return $c;
}

/** All active medicines (no PIN = MRP only). Cached for 10 minutes. */
function dawa4u_catalog() {
	$cached = get_transient( 'dawa4u_catalog_v1' );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$sb = dawa4u_supabase();
	if ( ! $sb['url'] || ! $sb['key'] ) {
		return array();
	}
	$res = wp_remote_post( $sb['url'] . '/rest/v1/rpc/shop_catalog', array(
		'timeout' => 8,
		'headers' => array( 'apikey' => $sb['key'], 'Authorization' => 'Bearer ' . $sb['key'], 'Content-Type' => 'application/json' ),
		'body'    => wp_json_encode( array( 'p_pin' => '' ) ),
	) );
	if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
		return array();
	}
	$rows = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $rows ) ) {
		return array();
	}
	set_transient( 'dawa4u_catalog_v1', $rows, 10 * MINUTE_IN_SECONDS );
	return $rows;
}

function dawa4u_med_card( $m, $cats ) {
	$mark = isset( $cats[ $m['category'] ] ) ? $cats[ $m['category'] ][0] : '+';
	$out  = '<article class="d4m-card" data-id="' . esc_attr( $m['id'] ) . '" data-cat="' . esc_attr( $m['category'] ) . '">';
	$out .= '<div class="d4m-ph">' . esc_html( $mark ) . '</div>';
	$out .= '<div class="d4m-body"><h3>' . esc_html( $m['name'] ) . '</h3>';
	$out .= '<p class="d4m-salt">' . esc_html( trim( $m['salt'] . ( $m['pack'] ? ' · ' . $m['pack'] : '' ), ' ·' ) ) . '</p>';
	if ( ! empty( $m['rx'] ) ) {
		$out .= '<span class="d4m-rx">Needs prescription</span>';
	}
	$out .= '</div><div class="d4m-foot"><span class="d4m-price">MRP ₹' . esc_html( number_format_i18n( (int) $m['mrp'] ) ) . '</span></div></article>';
	return $out;
}

add_shortcode( 'dawa4u_medicines', function ( $atts ) {
	$atts  = shortcode_atts( array( 'limit' => 0, 'category' => '' ), $atts );
	$limit = (int) $atts['limit'];
	$cats  = dawa4u_cats();
	$rows  = dawa4u_catalog();
	$shop  = DAWA4U_APPS . 'shop/';
	wp_enqueue_script( 'dawa4u-config', home_url( '/common/config.js' ), array(), null, true );
	wp_enqueue_script( 'dawa4u-medicines', get_template_directory_uri() . '/assets/medicines.js', array( 'dawa4u-config' ), wp_get_theme()->get( 'Version' ), true );

	$shown = $limit ? array_slice( $rows, 0, $limit ) : $rows;
	ob_start();
	?>
	<div class="d4m" data-d4u-meds data-shop="<?php echo esc_url( $shop ); ?>" data-limit="<?php echo esc_attr( $limit ); ?>" data-cat="<?php echo esc_attr( $atts['category'] ); ?>" data-all="<?php echo esc_url( home_url( '/medicines/' ) ); ?>" data-cats="<?php echo esc_attr( wp_json_encode( $cats ) ); ?>">
		<div class="d4m-bar">
			<?php if ( ! $limit ) : ?>
				<label class="d4m-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search medicines, salts, brands" aria-label="Search medicines" data-q></label>
			<?php endif; ?>
			<form class="d4m-pin" data-pinform><span>Deliver to</span><input inputmode="numeric" maxlength="6" placeholder="6-digit PIN" aria-label="Your PIN code" data-pin><button type="submit">Check</button></form>
		</div>
		<p class="d4m-status" data-status>Enter your PIN code to see the price and stock at the pharmacy nearest you.</p>
		<?php if ( ! $limit ) : ?>
			<div class="d4m-chips" role="tablist">
				<button type="button" class="on" data-chip="">All</button>
				<?php foreach ( $cats as $id => $c ) : ?>
					<button type="button" data-chip="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $c[1] ); ?></button>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
		<div class="d4m-grid" data-grid>
			<?php
			if ( $shown ) {
				foreach ( $shown as $m ) {
					echo dawa4u_med_card( $m, $cats ); // phpcs:ignore -- escaped inside
				}
			} else {
				echo '<p class="d4m-empty">Medicines will appear here in a moment.</p>';
			}
			?>
		</div>
		<?php if ( $limit ) : ?>
			<p class="d4m-more"><a href="<?php echo esc_url( home_url( '/medicines/' ) ); ?>">See all medicines →</a></p>
		<?php endif; ?>
		<a class="d4m-cartbar" href="<?php echo esc_url( $shop . '#/cart' ); ?>" data-cartbar hidden></a>
	</div>
	<?php
	return ob_get_clean();
} );
