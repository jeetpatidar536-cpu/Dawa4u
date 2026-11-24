<?php
/**
 * Billing software (Marg ERP, Busy, Tally, GoFrugal, any pharmacy POS) and dawa4u.
 *
 * Marg has no open API that other apps can call, so a pharmacy gets three ways in:
 *   1. Orders as a CSV file that Excel opens and Marg / other software can import.
 *   2. Stock from a CSV or Excel file exported from the billing software, shown next to each order.
 *   3. An API key + new-order alerts (webhook) for Marg's team or any software company to build a live link:
 *      REST under /wp-json/dawa4u/v1/ — read orders, mark packed (with your bill no.), approve or reject
 *      prescriptions, read the medicine list, send stock.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'D4U_API_NS' ) ) {
	define( 'D4U_API_NS', 'dawa4u/v1' );
}

/* ------------------------------------------------------------------ stock */

/** This pharmacy's stock: [ sku => [ 'qty' => int ] ]. */
function d4u_stock( $uid ) {
	$s = $uid ? get_user_meta( (int) $uid, 'd4u_stock', true ) : array();
	return is_array( $s ) ? $s : array();
}

function d4u_stock_save( $uid, $stock, $source ) {
	update_user_meta( $uid, 'd4u_stock', $stock );
	update_user_meta( $uid, 'd4u_stock_at', time() );
	update_user_meta( $uid, 'd4u_stock_src', $source );
}

/** Medicines customers can order: [ sku => WC_Product ] (no dawaPass). */
function d4u_sellable_products() {
	static $list = null;
	if ( null !== $list ) {
		return $list;
	}
	$list = array();
	foreach ( wc_get_products( array( 'status' => 'publish', 'limit' => 1000, 'orderby' => 'title', 'order' => 'ASC' ) ) as $p ) {
		if ( $p->get_sku() && ! d4u_is_pass_product( $p->get_id() ) ) {
			$list[ $p->get_sku() ] = $p;
		}
	}
	return $list;
}

/** Words that billing software adds to names ("DOLO 650 TAB 15'S") and that we leave out when matching. */
function d4u_name_key( $name ) {
	$skip   = array( 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules', 'syp', 'syr', 'syrup', 'susp', 'suspension', 'strip', 'strips', 'inj', 'injection', 'oint', 'ointment', 'cream', 'gel', 'drop', 'drops', 'bottle', 'pack', 'of' );
	$tokens = preg_split( '/[^a-z0-9\']+/', strtolower( remove_accents( (string) $name ) ), -1, PREG_SPLIT_NO_EMPTY );
	$units  = array( 'mg' => 'mg', 'mcg' => 'mcg', 'g' => 'g', 'gm' => 'g', 'gms' => 'g', 'ml' => 'ml', 'iu' => 'iu', '%' => '%' );
	$keep   = array();
	foreach ( $tokens as $i => $t ) {
		$t = trim( $t, "'" );
		if ( '' === $t || in_array( $t, $skip, true ) || preg_match( '/^\d+\'?s$/', $t ) || preg_match( '/^x\d+$/', $t ) ) {
			continue;
		}
		if ( isset( $units[ $t ] ) && $keep && is_numeric( end( $keep ) ) ) {
			$keep[ count( $keep ) - 1 ] .= $units[ $t ]; // "5 mg" and "5mg" are the same
			continue;
		}
		if ( preg_match( '/^(\d+(?:\.\d+)?)(gm|gms)$/', $t, $m ) ) {
			$t = $m[1] . 'g';
		}
		$keep[] = $t;
	}
	return implode( ' ', $keep );
}

/**
 * Read the rows of an uploaded CSV or .xlsx file.
 *
 * @return array|WP_Error list of rows (arrays of strings)
 */
function d4u_read_table( $path, $filename ) {
	$ext = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
	if ( 'xlsx' === $ext ) {
		return d4u_read_xlsx( $path );
	}
	if ( 'xls' === $ext ) {
		return new WP_Error( 'd4u_xls', 'This is an old Excel file (.xls). Open it in Excel and use “Save as” → “CSV” or “Excel Workbook (.xlsx)”, then upload that.' );
	}
	$raw = file_get_contents( $path ); // phpcs:ignore
	if ( false === $raw || '' === $raw ) {
		return new WP_Error( 'd4u_empty', 'The file is empty.' );
	}
	if ( 0 === strpos( $raw, "\xEF\xBB\xBF" ) ) {
		$raw = substr( $raw, 3 );
	}
	if ( function_exists( 'mb_check_encoding' ) && ! mb_check_encoding( $raw, 'UTF-8' ) && function_exists( 'mb_convert_encoding' ) ) {
		$raw = mb_convert_encoding( $raw, 'UTF-8', 'Windows-1252' );
	}
	$first = strtok( $raw, "\n" );
	$delim = ',';
	foreach ( array( "\t", ';' ) as $d ) {
		if ( substr_count( (string) $first, $d ) > substr_count( (string) $first, $delim ) ) {
			$delim = $d;
		}
	}
	$fh = fopen( 'php://temp', 'r+' ); // phpcs:ignore
	fwrite( $fh, $raw ); // phpcs:ignore
	rewind( $fh );
	$rows = array();
	while ( false !== ( $r = fgetcsv( $fh, 0, $delim, '"', '\\' ) ) ) { // phpcs:ignore
		if ( count( $rows ) > 20000 ) {
			break;
		}
		$rows[] = array_map( 'trim', array_map( 'strval', $r ) );
	}
	fclose( $fh ); // phpcs:ignore
	return $rows;
}

/** The first sheet of an .xlsx file (an .xlsx is a zip of XML files). */
function d4u_read_xlsx( $path ) {
	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error( 'd4u_zip', 'Excel files can’t be read on this server. Please save the file as CSV and upload that.' );
	}
	$zip = new ZipArchive();
	if ( true !== $zip->open( $path ) ) {
		return new WP_Error( 'd4u_xlsx', 'This Excel file could not be opened. Please save it as CSV and try again.' );
	}
	$sheet = 'xl/worksheets/sheet1.xml';
	if ( false === $zip->locateName( $sheet ) ) {
		$sheet = '';
		for ( $i = 0; $i < $zip->numFiles; $i++ ) {
			$n = $zip->getNameIndex( $i );
			if ( preg_match( '#^xl/worksheets/[^/]+\.xml$#', $n ) ) {
				$sheet = $n;
				break;
			}
		}
	}
	$stat = $sheet ? $zip->statName( $sheet ) : false;
	if ( ! $stat || $stat['size'] > 40 * MB_IN_BYTES ) {
		$zip->close();
		return new WP_Error( 'd4u_xlsx', 'No sheet found in this Excel file, or it is too big. Please save it as CSV and try again.' );
	}
	$opts   = LIBXML_NONET | LIBXML_NOCDATA;
	$shared = array();
	$ss     = $zip->getFromName( 'xl/sharedStrings.xml' );
	if ( false !== $ss ) {
		$x = simplexml_load_string( $ss, 'SimpleXMLElement', $opts );
		if ( $x ) {
			foreach ( $x->si as $si ) {
				if ( isset( $si->t ) ) {
					$shared[] = (string) $si->t;
				} else {
					$t = '';
					foreach ( $si->r as $r ) {
						$t .= (string) $r->t;
					}
					$shared[] = $t;
				}
			}
		}
	}
	$xml = simplexml_load_string( $zip->getFromName( $sheet ), 'SimpleXMLElement', $opts );
	$zip->close();
	if ( ! $xml || ! isset( $xml->sheetData ) ) {
		return new WP_Error( 'd4u_xlsx', 'This Excel file could not be read. Please save it as CSV and try again.' );
	}
	$rows = array();
	foreach ( $xml->sheetData->row as $row ) {
		if ( count( $rows ) > 20000 ) {
			break;
		}
		$cells = array();
		foreach ( $row->c as $c ) {
			$ref = (string) $c['r'];
			$col = 0;
			if ( preg_match( '/^([A-Z]+)/', $ref, $m ) ) {
				foreach ( str_split( $m[1] ) as $ch ) {
					$col = $col * 26 + ( ord( $ch ) - 64 );
				}
				$col--;
			} else {
				$col = count( $cells );
			}
			$t = (string) $c['t'];
			if ( 's' === $t ) {
				$v = isset( $shared[ (int) $c->v ] ) ? $shared[ (int) $c->v ] : '';
			} elseif ( 'inlineStr' === $t ) {
				$v = (string) $c->is->t;
			} else {
				$v = (string) $c->v;
			}
			$cells[ $col ] = trim( $v );
		}
		if ( $cells ) {
			$max  = max( array_keys( $cells ) );
			$line = array();
			for ( $i = 0; $i <= $max && $i < 200; $i++ ) {
				$line[] = isset( $cells[ $i ] ) ? $cells[ $i ] : '';
			}
			$rows[] = $line;
		} else {
			$rows[] = array();
		}
	}
	return $rows;
}

/**
 * Turn a stock file into [ sku => [ 'qty' => n ] ].
 *
 * Looks for a header row with an item code (or item name) column and a stock / qty column,
 * so a Marg "Stock" report, our template or a plain two-column file all work.
 * Several batches of one medicine are added together.
 */
function d4u_parse_stock_rows( $rows ) {
	$norm = function ( $h ) {
		return preg_replace( '/[^a-z0-9]/', '', strtolower( (string) $h ) );
	};
	$sku_names  = array( 'itemcode', 'dawa4ucode', 'sku', 'code', 'productcode', 'itemid', 'dawa4uitemcode' );
	$name_names = array( 'itemname', 'medicine', 'medicinename', 'name', 'product', 'productname', 'item', 'description', 'itemdescription', 'particulars' );
	$qty_names  = array( 'stock', 'yourstock', 'qty', 'quantity', 'closingstock', 'closing', 'closingqty', 'balance', 'balqty', 'balanceqty', 'currentstock', 'stockqty', 'availableqty', 'available', 'clqty' );

	$head = -1;
	$cs   = -1;
	$cn   = -1;
	$cq   = -1;
	foreach ( array_slice( $rows, 0, 25, true ) as $i => $r ) {
		$s = -1;
		$n = -1;
		$q = -1;
		foreach ( $r as $j => $cell ) {
			$h = $norm( $cell );
			if ( '' === $h ) {
				continue;
			}
			if ( $s < 0 && in_array( $h, $sku_names, true ) ) {
				$s = $j;
			} elseif ( $n < 0 && in_array( $h, $name_names, true ) ) {
				$n = $j;
			} elseif ( $q < 0 && ( in_array( $h, $qty_names, true ) || ( false !== strpos( $h, 'stock' ) && false === strpos( $h, 'value' ) ) ) ) {
				$q = $j;
			}
		}
		if ( $q >= 0 && ( $s >= 0 || $n >= 0 ) ) {
			list( $head, $cs, $cn, $cq ) = array( $i, $s, $n, $q );
			break;
		}
	}
	if ( $head < 0 ) {
		return new WP_Error( 'd4u_cols', 'We couldn’t find the columns. The file needs a heading row with “Item code” (or “Item name”) and “Stock” (or “Qty”). Download the stock template below to see the layout.' );
	}

	$products = d4u_sellable_products();
	$by_sku   = array();
	$by_name  = array();
	$twice    = array();
	foreach ( $products as $sku => $p ) {
		$by_sku[ strtolower( $sku ) ] = $sku;
		$k                            = d4u_name_key( $p->get_name() );
		if ( '' === $k ) {
			continue;
		}
		if ( isset( $by_name[ $k ] ) ) {
			$twice[ $k ] = true;
		}
		$by_name[ $k ] = $sku;
	}
	foreach ( array_keys( $twice ) as $k ) {
		unset( $by_name[ $k ] ); // two medicines with the same name: only the item code can tell them apart
	}

	$stock   = array();
	$missed  = array();
	$matched = 0;
	foreach ( array_slice( $rows, $head + 1 ) as $r ) {
		$code = $cs >= 0 && isset( $r[ $cs ] ) ? strtolower( trim( $r[ $cs ] ) ) : '';
		$name = $cn >= 0 && isset( $r[ $cn ] ) ? trim( $r[ $cn ] ) : '';
		$qraw = isset( $r[ $cq ] ) ? str_replace( ',', '', (string) $r[ $cq ] ) : '';
		if ( '' === $code && '' === $name ) {
			continue;
		}
		if ( ! preg_match( '/-?\d+(\.\d+)?/', $qraw, $m ) ) {
			continue; // totals, notes, blank stock
		}
		$qty = max( 0, (int) floor( (float) $m[0] ) );
		$sku = '';
		if ( '' !== $code && isset( $by_sku[ $code ] ) ) {
			$sku = $by_sku[ $code ];
		} elseif ( '' !== $name ) {
			$k = d4u_name_key( $name );
			if ( isset( $by_name[ $k ] ) ) {
				$sku = $by_name[ $k ];
			}
		}
		if ( '' === $sku ) {
			if ( count( $missed ) < 400 ) {
				$missed[] = '' !== $name ? $name : $code;
			}
			continue;
		}
		$matched++;
		$stock[ $sku ] = array( 'qty' => ( isset( $stock[ $sku ] ) ? $stock[ $sku ]['qty'] : 0 ) + $qty );
	}
	return array( $stock, array_values( array_unique( $missed ) ), $matched );
}

/* ------------------------------------------------------------------ API keys */

function d4u_key_hash( $key ) {
	return hash_hmac( 'sha256', $key, wp_salt( 'auth' ) );
}

/** A new key for a pharmacy. Only its hash is kept; the key itself is shown once. */
function d4u_key_make( $uid ) {
	$key = 'd4u_' . (int) $uid . '_' . bin2hex( random_bytes( 20 ) );
	update_user_meta( $uid, 'd4u_api_key', array(
		'hash'    => d4u_key_hash( $key ),
		'last4'   => substr( $key, -4 ),
		'created' => time(),
	) );
	delete_user_meta( $uid, 'd4u_api_used' );
	return $key;
}

/** The pharmacy a key belongs to, or 0. */
function d4u_key_user( $key ) {
	if ( ! is_string( $key ) || ! preg_match( '/^d4u_(\d+)_[0-9a-f]{40}$/', $key, $m ) ) {
		return 0;
	}
	$uid = (int) $m[1];
	$k   = get_user_meta( $uid, 'd4u_api_key', true );
	if ( ! is_array( $k ) || empty( $k['hash'] ) || ! hash_equals( $k['hash'], d4u_key_hash( $key ) ) ) {
		return 0;
	}
	return $uid;
}

function d4u_request_key( WP_REST_Request $req ) {
	$key = (string) $req->get_header( 'x_dawa4u_key' );
	if ( '' === $key ) {
		$auth = (string) $req->get_header( 'authorization' );
		if ( 0 === stripos( $auth, 'Bearer ' ) ) {
			$key = trim( substr( $auth, 7 ) );
		}
	}
	return trim( $key );
}

/** permission_callback for every dawa4u API route. */
function d4u_api_auth( WP_REST_Request $req ) {
	$key = d4u_request_key( $req );
	if ( '' === $key ) {
		return new WP_Error( 'd4u_no_key', 'Send your dawa4u API key in the X-Dawa4u-Key header.', array( 'status' => 401 ) );
	}
	$uid = d4u_key_user( $key );
	if ( ! $uid ) {
		return new WP_Error( 'd4u_bad_key', 'This API key is not valid. Make a new one in the pharmacy dashboard → Billing software.', array( 'status' => 401 ) );
	}
	if ( ! d4u_is_pharmacy( $uid ) || 'approved' !== d4u_status( $uid ) ) {
		return new WP_Error( 'd4u_not_approved', 'This pharmacy account is not active.', array( 'status' => 403 ) );
	}
	wp_set_current_user( $uid );
	$used = (int) get_user_meta( $uid, 'd4u_api_used', true );
	if ( time() - $used > 60 ) {
		update_user_meta( $uid, 'd4u_api_used', time() );
	}
	return true;
}

/* ------------------------------------------------------------------ the API */

function d4u_api_status( $wc ) {
	$map = array(
		'd4u-rx'      => 'to_check',
		'processing'  => 'to_pack',
		'd4u-request' => 'request',
		'd4u-ready'   => 'ready_for_pickup',
		'd4u-out'     => 'with_rider',
		'completed'   => 'delivered',
		'cancelled'   => 'cancelled',
		'pending'     => 'waiting_for_payment',
		'on-hold'     => 'waiting_for_payment',
	);
	$wc = 0 === strpos( $wc, 'wc-' ) ? substr( $wc, 3 ) : $wc;
	return isset( $map[ $wc ] ) ? $map[ $wc ] : $wc;
}

function d4u_api_statuses( $filter ) {
	$open = array( 'd4u-rx', 'processing', 'd4u-request', 'd4u-ready', 'd4u-out' );
	$map  = array(
		'to_check'         => array( 'd4u-rx' ),
		'to_pack'          => array( 'processing' ),
		'request'          => array( 'd4u-request' ),
		'ready_for_pickup' => array( 'd4u-ready' ),
		'with_rider'       => array( 'd4u-ready', 'd4u-out' ),
		'delivered'        => array( 'completed' ),
		'cancelled'        => array( 'cancelled' ),
		'open'             => $open,
		'all'              => array_merge( $open, array( 'completed', 'cancelled', 'pending', 'on-hold' ) ),
	);
	return isset( $map[ $filter ] ) ? $map[ $filter ] : null;
}

function d4u_api_time( $d ) {
	return $d ? $d->format( DATE_ATOM ) : null;
}

/** An order as the API (and the webhook) shows it. No delivery code — that stays between rider and customer. */
function d4u_api_order( $o ) {
	$items = array();
	$stock = d4u_stock( (int) $o->get_meta( '_d4u_pharmacy' ) );
	foreach ( $o->get_items() as $item ) {
		if ( d4u_is_pass_product( $item->get_product_id() ) ) {
			continue;
		}
		$p   = $item->get_product();
		$sku = $p ? $p->get_sku() : '';
		$qty = (int) $item->get_quantity();
		$items[] = array(
			'sku'        => $sku,
			'name'       => $item->get_name(),
			'salt'       => $p ? (string) get_post_meta( $p->get_id(), '_d4u_salt', true ) : '',
			'pack'       => $p ? (string) get_post_meta( $p->get_id(), '_d4u_pack', true ) : '',
			'qty'        => $qty,
			'mrp'        => $qty ? round( (float) $item->get_subtotal() / $qty, 2 ) : 0,
			'amount'     => round( (float) $item->get_total(), 2 ),
			'rx'         => $p ? d4u_needs_rx( $p ) : false,
			'your_stock' => ( $sku && isset( $stock[ $sku ] ) ) ? (int) $stock[ $sku ]['qty'] : null,
		);
	}
	$charges = array();
	foreach ( $o->get_items( 'shipping' ) as $s ) {
		$charges[] = array( 'name' => $s->get_name(), 'amount' => round( (float) $s->get_total(), 2 ) );
	}
	foreach ( $o->get_fees() as $f ) {
		$charges[] = array( 'name' => $f->get_name(), 'amount' => round( (float) $f->get_total(), 2 ) );
	}
	$cod   = 'cod' === $o->get_payment_method();
	$rider = (int) $o->get_meta( '_d4u_rider' );
	$files = $o->get_meta( '_d4u_rx_files' );
	$rxs   = (string) $o->get_meta( '_d4u_rx_state' );
	return array(
		'id'              => $o->get_id(),
		'number'          => (string) $o->get_order_number(),
		'status'          => d4u_api_status( $o->get_status() ),
		'created_at'      => d4u_api_time( $o->get_date_created() ),
		'updated_at'      => d4u_api_time( $o->get_date_modified() ),
		'customer'        => array(
			'name'  => trim( $o->get_billing_first_name() . ' ' . $o->get_billing_last_name() ),
			'phone' => $o->get_billing_phone(),
		),
		'address'         => array(
			'line1' => $o->get_shipping_address_1() ? $o->get_shipping_address_1() : $o->get_billing_address_1(),
			'line2' => $o->get_shipping_address_2() ? $o->get_shipping_address_2() : $o->get_billing_address_2(),
			'city'  => $o->get_shipping_city() ? $o->get_shipping_city() : $o->get_billing_city(),
			'state' => $o->get_shipping_state() ? $o->get_shipping_state() : $o->get_billing_state(),
			'pin'   => d4u_order_pin( $o ),
		),
		'items'           => $items,
		'medicines_total' => round( d4u_order_medicine_value( $o ), 2 ),
		'charges'         => $charges,
		'discount'        => round( (float) $o->get_discount_total(), 2 ),
		'total'           => round( (float) $o->get_total(), 2 ),
		'currency'        => $o->get_currency(),
		'payment'         => array(
			'method'              => $o->get_payment_method(),
			'title'               => $o->get_payment_method_title(),
			'paid'                => ! $cod && (bool) $o->get_date_paid(),
			'collect_on_delivery' => $cod ? round( (float) $o->get_total(), 2 ) : 0,
		),
		'note'            => $o->get_customer_note(),
		'prescription'    => array(
			'needed' => '' !== $rxs || $o->has_status( 'd4u-request' ),
			'state'  => '' !== $rxs ? $rxs : null,
			'files'  => is_array( $files ) ? count( $files ) : 0,
			'check'  => d4u_ph_url( $o->has_status( 'd4u-request' ) ? 'requests' : 'rx' ),
		),
		'rider'           => $rider ? array(
			'name'  => d4u_partner_name( $rider ),
			'phone' => (string) get_user_meta( $rider, 'd4u_phone', true ),
		) : null,
		'bill_no'         => (string) $o->get_meta( '_d4u_bill_no' ),
	);
}

function d4u_api_find_order( WP_REST_Request $req ) {
	$o = wc_get_order( (int) $req['id'] );
	if ( ! $o || (int) $o->get_meta( '_d4u_pharmacy' ) !== get_current_user_id() ) {
		return new WP_Error( 'd4u_no_order', 'No such order for your pharmacy.', array( 'status' => 404 ) );
	}
	return $o;
}

function d4u_api_wrong_status( $o, $need ) {
	return new WP_Error(
		'd4u_wrong_status',
		sprintf( 'Order #%s is “%s”, not “%s”.', $o->get_order_number(), d4u_api_status( $o->get_status() ), $need ),
		array( 'status' => 409, 'current_status' => d4u_api_status( $o->get_status() ) )
	);
}

add_action( 'rest_api_init', function () {
	$auth = 'd4u_api_auth';

	register_rest_route( D4U_API_NS, '/me', array(
		'methods'             => 'GET',
		'permission_callback' => $auth,
		'callback'            => function () {
			$uid = get_current_user_id();
			$k   = get_user_meta( $uid, 'd4u_api_key', true );
			return array(
				'pharmacy_id' => $uid,
				'name'        => d4u_partner_name( $uid ),
				'pins'        => d4u_pins( $uid ),
				'open'        => 'yes' === get_user_meta( $uid, 'd4u_open', true ),
				'key_ends'    => is_array( $k ) ? $k['last4'] : '',
				'stock_items' => count( d4u_stock( $uid ) ),
				'counts'      => d4u_ph_counts( $uid ),
			);
		},
	) );

	register_rest_route( D4U_API_NS, '/orders', array(
		'methods'             => 'GET',
		'permission_callback' => $auth,
		'args'                => array(
			'status' => array( 'default' => 'open', 'type' => 'string' ),
			'since'  => array( 'type' => 'string' ),
			'limit'  => array( 'default' => 50, 'type' => 'integer', 'minimum' => 1, 'maximum' => 200 ),
		),
		'callback'            => function ( WP_REST_Request $req ) {
			$st = d4u_api_statuses( sanitize_key( $req['status'] ) );
			if ( null === $st ) {
				return new WP_Error( 'd4u_status', 'status must be one of: open, to_check, to_pack, request, ready_for_pickup, with_rider, delivered, cancelled, all.', array( 'status' => 400 ) );
			}
			$args = array( 'limit' => (int) $req['limit'], 'orderby' => 'date', 'order' => 'DESC' );
			if ( ! empty( $req['since'] ) ) {
				$since = ctype_digit( (string) $req['since'] ) ? (int) $req['since'] : strtotime( (string) $req['since'] );
				if ( ! $since ) {
					return new WP_Error( 'd4u_since', 'since must be a date like 2026-11-24T10:00:00+05:30 or a Unix time.', array( 'status' => 400 ) );
				}
				$args['date_modified'] = '>=' . $since;
				$args['orderby']       = 'modified';
				$args['order']         = 'ASC';
			}
			$orders = d4u_ph_query( get_current_user_id(), $st, $args );
			return array(
				'count'       => count( $orders ),
				'server_time' => gmdate( DATE_ATOM ),
				'orders'      => array_map( 'd4u_api_order', $orders ),
			);
		},
	) );

	register_rest_route( D4U_API_NS, '/orders/(?P<id>\d+)', array(
		'methods'             => 'GET',
		'permission_callback' => $auth,
		'callback'            => function ( WP_REST_Request $req ) {
			$o = d4u_api_find_order( $req );
			return is_wp_error( $o ) ? $o : d4u_api_order( $o );
		},
	) );

	register_rest_route( D4U_API_NS, '/orders/(?P<id>\d+)/packed', array(
		'methods'             => 'POST',
		'permission_callback' => $auth,
		'callback'            => function ( WP_REST_Request $req ) {
			$o = d4u_api_find_order( $req );
			if ( is_wp_error( $o ) ) {
				return $o;
			}
			if ( ! $o->has_status( 'processing' ) ) {
				return d4u_api_wrong_status( $o, 'to_pack' );
			}
			d4u_ph_packed( $o, get_current_user_id(), sanitize_text_field( (string) $req['bill_no'] ) );
			return d4u_api_order( wc_get_order( $o->get_id() ) );
		},
	) );

	register_rest_route( D4U_API_NS, '/orders/(?P<id>\d+)/prescription', array(
		'methods'             => 'POST',
		'permission_callback' => $auth,
		'callback'            => function ( WP_REST_Request $req ) {
			$o = d4u_api_find_order( $req );
			if ( is_wp_error( $o ) ) {
				return $o;
			}
			if ( ! $o->has_status( 'd4u-rx' ) ) {
				return d4u_api_wrong_status( $o, 'to_check' );
			}
			$decision = sanitize_key( (string) $req['decision'] );
			if ( 'approve' === $decision ) {
				d4u_ph_approve( $o, get_current_user_id() );
			} elseif ( 'reject' === $decision ) {
				$reason = sanitize_text_field( (string) $req['reason'] );
				if ( '' === $reason ) {
					return new WP_Error( 'd4u_reason', 'Give a reason when rejecting — the customer sees it.', array( 'status' => 400 ) );
				}
				d4u_reject_order( $o, $reason, d4u_partner_name( get_current_user_id() ) );
			} else {
				return new WP_Error( 'd4u_decision', 'decision must be "approve" or "reject".', array( 'status' => 400 ) );
			}
			return d4u_api_order( wc_get_order( $o->get_id() ) );
		},
	) );

	register_rest_route( D4U_API_NS, '/orders/(?P<id>\d+)/pass', array(
		'methods'             => 'POST',
		'permission_callback' => $auth,
		'callback'            => function ( WP_REST_Request $req ) {
			$o = d4u_api_find_order( $req );
			if ( is_wp_error( $o ) ) {
				return $o;
			}
			if ( ! $o->has_status( array( 'd4u-rx', 'processing', 'd4u-request' ) ) || ( $o->has_status( 'processing' ) && 'approved' === $o->get_meta( '_d4u_rx_state' ) ) ) {
				return d4u_api_wrong_status( $o, 'to_check, to_pack (no prescription approved) or request' );
			}
			$next = d4u_ph_pass( $o, get_current_user_id(), sanitize_text_field( (string) $req['reason'] ) );
			return array( 'passed' => true, 'id' => $o->get_id(), 'sent_to_another_pharmacy' => (bool) $next );
		},
	) );

	register_rest_route( D4U_API_NS, '/medicines', array(
		'methods'             => 'GET',
		'permission_callback' => $auth,
		'callback'            => function () {
			$stock = d4u_stock( get_current_user_id() );
			$out   = array();
			foreach ( d4u_sellable_products() as $sku => $p ) {
				$cats  = wp_get_post_terms( $p->get_id(), 'product_cat', array( 'fields' => 'names' ) );
				$out[] = array(
					'sku'        => $sku,
					'name'       => $p->get_name(),
					'salt'       => (string) get_post_meta( $p->get_id(), '_d4u_salt', true ),
					'pack'       => (string) get_post_meta( $p->get_id(), '_d4u_pack', true ),
					'mrp'        => (float) ( $p->get_regular_price() ? $p->get_regular_price() : $p->get_price() ),
					'price'      => (float) $p->get_price(),
					'rx'         => d4u_needs_rx( $p ),
					'category'   => is_array( $cats ) && $cats ? wp_specialchars_decode( $cats[0], ENT_QUOTES ) : '',
					'your_stock' => isset( $stock[ $sku ] ) ? (int) $stock[ $sku ]['qty'] : null,
				);
			}
			return array( 'count' => count( $out ), 'medicines' => $out );
		},
	) );

	register_rest_route( D4U_API_NS, '/stock', array(
		array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => function () {
				$uid   = get_current_user_id();
				$items = array();
				foreach ( d4u_stock( $uid ) as $sku => $s ) {
					$items[] = array( 'sku' => $sku, 'qty' => (int) $s['qty'] );
				}
				$at = (int) get_user_meta( $uid, 'd4u_stock_at', true );
				return array( 'updated_at' => $at ? gmdate( DATE_ATOM, $at ) : null, 'items' => $items );
			},
		),
		array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => function ( WP_REST_Request $req ) {
				$uid   = get_current_user_id();
				$items = $req['items'];
				if ( ! is_array( $items ) || ! $items ) {
					return new WP_Error( 'd4u_items', 'Send {"items":[{"sku":"d4u-…","qty":10}], "replace": false}.', array( 'status' => 400 ) );
				}
				if ( count( $items ) > 5000 ) {
					return new WP_Error( 'd4u_items', 'At most 5000 items at a time.', array( 'status' => 400 ) );
				}
				$known   = d4u_sellable_products();
				$stock   = $req['replace'] ? array() : d4u_stock( $uid );
				$unknown = array();
				$n       = 0;
				foreach ( $items as $it ) {
					$sku = is_array( $it ) && isset( $it['sku'] ) ? (string) $it['sku'] : '';
					if ( ! isset( $known[ $sku ] ) || ! isset( $it['qty'] ) || ! is_numeric( $it['qty'] ) ) {
						if ( count( $unknown ) < 100 ) {
							$unknown[] = substr( $sku, 0, 60 );
						}
						continue;
					}
					$stock[ $sku ] = array( 'qty' => max( 0, (int) floor( (float) $it['qty'] ) ) );
					$n++;
				}
				d4u_stock_save( $uid, $stock, 'api' );
				return array( 'updated' => $n, 'unknown_skus' => $unknown, 'stock_items' => count( $stock ) );
			},
		),
	) );
} );

// Never cache API answers (orders change every minute).
add_filter( 'rest_post_dispatch', function ( $res, $server, $req ) {
	if ( 0 === strpos( $req->get_route(), '/' . D4U_API_NS ) && $res instanceof WP_HTTP_Response ) {
		$res->header( 'Cache-Control', 'no-store, private' );
		do_action( 'litespeed_control_set_nocache', 'dawa4u api' ); // phpcs:ignore
	}
	return $res;
}, 10, 3 );

/* ------------------------------------------------------------------ new-order alerts (webhook) */

/**
 * POST an event to the pharmacy's alert URL, signed with its secret:
 *   X-Dawa4u-Signature: sha256=<hex HMAC-SHA256 of the raw body>
 *
 * @return int|WP_Error HTTP status when $wait, otherwise 0
 */
function d4u_hook_send( $uid, $event, $order = null, $wait = false ) {
	$url    = (string) get_user_meta( $uid, 'd4u_hook_url', true );
	$secret = (string) get_user_meta( $uid, 'd4u_hook_secret', true );
	if ( '' === $url || '' === $secret ) {
		return new WP_Error( 'd4u_hook', 'No alert URL saved.' );
	}
	$body = wp_json_encode( array(
		'event'       => $event,
		'sent_at'     => gmdate( DATE_ATOM ),
		'pharmacy_id' => (int) $uid,
		'order'       => $order ? d4u_api_order( $order ) : null,
	) );
	$res = wp_safe_remote_post( $url, array(
		'timeout'     => $wait ? 10 : 3,
		'blocking'    => (bool) $wait,
		'redirection' => 0,
		'headers'     => array(
			'Content-Type'       => 'application/json; charset=utf-8',
			'User-Agent'         => 'dawa4u-webhook/1',
			'X-Dawa4u-Event'     => $event,
			'X-Dawa4u-Signature' => 'sha256=' . hash_hmac( 'sha256', $body, $secret ),
		),
		'body'        => $body,
	) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	return $wait ? (int) wp_remote_retrieve_response_code( $res ) : 0;
}

add_action( 'woocommerce_order_status_changed', function ( $order_id, $from, $to, $order = null ) {
	$order = $order instanceof WC_Order ? $order : wc_get_order( $order_id );
	if ( ! $order || $order->get_status() !== $to ) {
		return; // moved on again in the same request (UPI confirmed → prescription check): only the last step is sent
	}
	if ( ! in_array( $to, array( 'd4u-rx', 'processing', 'd4u-request', 'd4u-ready', 'd4u-out', 'completed', 'cancelled' ), true ) ) {
		return;
	}
	$ph = (int) $order->get_meta( '_d4u_pharmacy' );
	if ( $ph && get_user_meta( $ph, 'd4u_hook_url', true ) ) {
		d4u_hook_send( $ph, 'order.' . d4u_api_status( $to ), $order );
	}
}, 30, 4 );

/* ------------------------------------------------------------------ downloads: orders CSV, stock template */

function d4u_csv_cell( $v ) {
	$v = (string) $v;
	// Stop Excel from running anything a customer typed as a formula.
	return ( '' !== $v && in_array( $v[0], array( '=', '+', '-', '@', "\t", "\r" ), true ) ) ? "'" . $v : $v;
}

function d4u_csv_out( $filename, $rows ) {
	nocache_headers();
	header( 'Content-Type: text/csv; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
	header( 'X-Content-Type-Options: nosniff' );
	$fh = fopen( 'php://output', 'w' ); // phpcs:ignore
	fwrite( $fh, "\xEF\xBB\xBF" ); // phpcs:ignore -- so Excel reads ₹ and Hindi names right
	foreach ( $rows as $r ) {
		fputcsv( $fh, $r, ',', '"', '\\' );
	}
	fclose( $fh ); // phpcs:ignore
	exit;
}

add_action( 'template_redirect', function () {
	if ( empty( $_GET['d4u_export'] ) ) { // phpcs:ignore
		return;
	}
	$what = sanitize_key( wp_unslash( $_GET['d4u_export'] ) ); // phpcs:ignore
	$uid  = get_current_user_id();
	$boss = $uid && d4u_is_boss( $uid );
	if ( ! $uid || ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ), 'd4u_export' ) ) {
		wp_die( 'This download link has expired. Open the dashboard and try again.', 'dawa4u', array( 'response' => 403 ) );
	}
	if ( ! $boss && ! ( d4u_is_pharmacy( $uid ) && 'approved' === d4u_status( $uid ) ) ) {
		wp_die( 'Only partner pharmacies can download this.', 'dawa4u', array( 'response' => 403 ) );
	}

	if ( 'stock_template' === $what && ! $boss ) {
		$stock = d4u_stock( $uid );
		$rows  = array( array( 'Item code', 'Medicine', 'Contains', 'Pack', 'MRP', 'Stock' ) );
		foreach ( d4u_sellable_products() as $sku => $p ) {
			$rows[] = array( $sku, $p->get_name(), get_post_meta( $p->get_id(), '_d4u_salt', true ), get_post_meta( $p->get_id(), '_d4u_pack', true ), (float) $p->get_price(), isset( $stock[ $sku ] ) ? (int) $stock[ $sku ]['qty'] : '' );
		}
		d4u_csv_out( 'dawa4u-stock.csv', $rows );
	}

	if ( 'orders' !== $what ) {
		wp_die( 'Unknown download.', 'dawa4u', array( 'response' => 404 ) );
	}
	$tz   = wp_timezone();
	$from = isset( $_GET['from'] ) ? DateTime::createFromFormat( '!Y-m-d', sanitize_text_field( wp_unslash( $_GET['from'] ) ), $tz ) : false; // phpcs:ignore
	$to   = isset( $_GET['to'] ) ? DateTime::createFromFormat( '!Y-m-d', sanitize_text_field( wp_unslash( $_GET['to'] ) ), $tz ) : false; // phpcs:ignore
	$from = $from ? $from : new DateTime( 'today -6 days', $tz );
	$to   = $to ? $to : new DateTime( 'today', $tz );
	if ( $to < $from ) {
		list( $from, $to ) = array( $to, $from );
	}
	if ( $from->diff( $to )->days > 366 ) {
		$from = ( clone $to )->modify( '-366 days' );
	}
	$end    = ( clone $to )->modify( '+1 day' )->getTimestamp() - 1;
	$orders = d4u_ph_query( $uid, array( 'd4u-rx', 'processing', 'd4u-request', 'd4u-ready', 'd4u-out', 'completed', 'cancelled' ), array(
		'date_created' => $from->getTimestamp() . '...' . $end,
		'order'        => 'ASC',
	) );

	$head = array( 'Date', 'Time', 'Order no', 'Status', 'Customer', 'Phone', 'Address', 'PIN', 'Item code', 'Medicine', 'Contains', 'Pack', 'Qty', 'MRP', 'Amount', 'Order total', 'Payment', 'Paid', 'Your bill no' );
	if ( $boss ) {
		$head[] = 'Pharmacy';
	}
	$rows = array( $head );
	foreach ( $orders as $o ) {
		$d     = $o->get_date_created();
		$base  = array(
			$d ? $d->date_i18n( 'd-m-Y' ) : '',
			$d ? $d->date_i18n( 'H:i' ) : '',
			$o->get_order_number(),
			wc_get_order_status_name( $o->get_status() ),
			d4u_csv_cell( trim( $o->get_billing_first_name() . ' ' . $o->get_billing_last_name() ) ),
			preg_replace( '/[^0-9]/', '', $o->get_billing_phone() ),
			d4u_csv_cell( d4u_order_address( $o ) ),
			d4u_order_pin( $o ),
		);
		$cod   = 'cod' === $o->get_payment_method();
		$tail  = array( $cod ? 'Cash on delivery' : d4u_csv_cell( $o->get_payment_method_title() ), ( ! $cod && $o->get_date_paid() ) || $o->has_status( 'completed' ) ? 'Yes' : 'No', d4u_csv_cell( $o->get_meta( '_d4u_bill_no' ) ) );
		$first = true;
		$lines = 0;
		foreach ( $o->get_items() as $item ) {
			if ( d4u_is_pass_product( $item->get_product_id() ) ) {
				continue;
			}
			$p   = $item->get_product();
			$qty = (int) $item->get_quantity();
			$row = array_merge( $base, array(
				$p ? $p->get_sku() : '',
				d4u_csv_cell( $item->get_name() ),
				$p ? d4u_csv_cell( get_post_meta( $p->get_id(), '_d4u_salt', true ) ) : '',
				$p ? d4u_csv_cell( get_post_meta( $p->get_id(), '_d4u_pack', true ) ) : '',
				$qty,
				$qty ? round( (float) $item->get_subtotal() / $qty, 2 ) : 0,
				round( (float) $item->get_total(), 2 ),
				$first ? round( (float) $o->get_total(), 2 ) : '',
			), $tail );
			if ( $boss ) {
				$row[] = d4u_csv_cell( d4u_partner_name( (int) $o->get_meta( '_d4u_pharmacy' ) ) );
			}
			$rows[] = $row;
			$first  = false;
			$lines++;
		}
		if ( ! $lines ) { // a prescription request the pharmacist hasn't filled in yet
			$row = array_merge( $base, array( '', 'Prescription sent — medicines not added yet', '', '', '', '', '', round( (float) $o->get_total(), 2 ) ), $tail );
			if ( $boss ) {
				$row[] = d4u_csv_cell( d4u_partner_name( (int) $o->get_meta( '_d4u_pharmacy' ) ) );
			}
			$rows[] = $row;
		}
	}
	d4u_csv_out( 'dawa4u-orders-' . $from->format( 'Y-m-d' ) . '-to-' . $to->format( 'Y-m-d' ) . '.csv', $rows );
}, 6 );

function d4u_export_url( $what, $args = array() ) {
	return add_query_arg( array_merge( array( 'd4u_export' => $what, '_wpnonce' => wp_create_nonce( 'd4u_export' ) ), $args ), d4u_ph_url() );
}

/* ------------------------------------------------------------------ dashboard forms */

function d4u_connect_uid() {
	$uid = get_current_user_id();
	if ( ! $uid || ! d4u_is_pharmacy( $uid ) || 'approved' !== d4u_status( $uid ) ) {
		d4u_back( 'Only an approved partner pharmacy can do this.', 'error' );
	}
	return $uid;
}

function d4u_do_ph_key() {
	$uid = d4u_connect_uid();
	$op  = isset( $_POST['op'] ) ? sanitize_key( $_POST['op'] ) : ''; // phpcs:ignore
	if ( 'off' === $op ) {
		delete_user_meta( $uid, 'd4u_api_key' );
		delete_user_meta( $uid, 'd4u_api_used' );
		d4u_back( 'API key turned off. Software using it can no longer reach your orders.', 'ok' );
	}
	set_transient( 'd4u_newkey_' . $uid, d4u_key_make( $uid ), 10 * MINUTE_IN_SECONDS );
	d4u_back( 'Your new API key is ready. Copy it now — for safety it is shown only once.', 'ok' );
}

function d4u_do_ph_hook() {
	$uid = d4u_connect_uid();
	$op  = isset( $_POST['op'] ) ? sanitize_key( $_POST['op'] ) : 'save'; // phpcs:ignore
	if ( 'off' === $op ) {
		delete_user_meta( $uid, 'd4u_hook_url' );
		delete_user_meta( $uid, 'd4u_hook_secret' );
		d4u_back( 'New-order alerts turned off.', 'ok' );
	}
	if ( 'test' === $op ) {
		$code = d4u_hook_send( $uid, 'test', null, true );
		if ( is_wp_error( $code ) ) {
			d4u_back( 'Test alert failed: ' . esc_html( $code->get_error_message() ), 'error' );
		}
		d4u_back( 'Test alert sent. Your software answered with HTTP ' . (int) $code . ( $code >= 200 && $code < 300 ? ' — working.' : ' — it should answer 200.' ), $code >= 200 && $code < 300 ? 'ok' : 'error' );
	}
	$url = isset( $_POST['url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['url'] ) ), array( 'https' ) ) : ''; // phpcs:ignore
	if ( '' === $url || 0 !== strpos( $url, 'https://' ) || ! wp_http_validate_url( $url ) ) {
		d4u_back( 'Enter a full https:// address on the public internet (for example https://yourserver.com/dawa4u).', 'error' );
	}
	update_user_meta( $uid, 'd4u_hook_url', $url );
	if ( ! get_user_meta( $uid, 'd4u_hook_secret', true ) || ! empty( $_POST['new_secret'] ) ) { // phpcs:ignore
		$secret = 'whsec_' . bin2hex( random_bytes( 20 ) );
		update_user_meta( $uid, 'd4u_hook_secret', $secret );
		set_transient( 'd4u_newsecret_' . $uid, $secret, 10 * MINUTE_IN_SECONDS );
		d4u_back( 'Alert address saved. Copy the signing secret now — it is shown only once.', 'ok' );
	}
	d4u_back( 'Alert address saved.', 'ok' );
}

function d4u_do_ph_stock() {
	$uid = d4u_connect_uid();
	$op  = isset( $_POST['op'] ) ? sanitize_key( $_POST['op'] ) : 'upload'; // phpcs:ignore
	if ( 'clear' === $op ) {
		delete_user_meta( $uid, 'd4u_stock' );
		delete_user_meta( $uid, 'd4u_stock_at' );
		delete_user_meta( $uid, 'd4u_stock_src' );
		d4u_back( 'Stock cleared.', 'ok' );
	}
	$f = isset( $_FILES['stock'] ) ? $_FILES['stock'] : null; // phpcs:ignore
	if ( ! $f || ! empty( $f['error'] ) || empty( $f['tmp_name'] ) || ! is_uploaded_file( $f['tmp_name'] ) ) {
		d4u_back( 'Choose a stock file (CSV or Excel .xlsx) first.', 'error' );
	}
	if ( $f['size'] > 5 * MB_IN_BYTES ) {
		d4u_back( 'That file is bigger than 5 MB. Export only the stock columns and try again.', 'error' );
	}
	$ext = strtolower( pathinfo( (string) $f['name'], PATHINFO_EXTENSION ) );
	if ( ! in_array( $ext, array( 'csv', 'txt', 'tsv', 'xlsx', 'xls' ), true ) ) {
		d4u_back( 'Upload a CSV or Excel (.xlsx) file.', 'error' );
	}
	$rows = d4u_read_table( $f['tmp_name'], (string) $f['name'] );
	if ( is_wp_error( $rows ) ) {
		d4u_back( $rows->get_error_message(), 'error' );
	}
	$res = d4u_parse_stock_rows( $rows );
	if ( is_wp_error( $res ) ) {
		d4u_back( $res->get_error_message(), 'error' );
	}
	list( $stock, $missed, $matched ) = $res;
	if ( ! $stock ) {
		d4u_back( 'None of the lines matched a dawa4u medicine. Use the “Item code” column from the stock template, or medicine names exactly as on dawa4u.', 'error' );
	}
	d4u_stock_save( $uid, $stock, 'file' );
	set_transient( 'd4u_stockmiss_' . $uid, $missed, 10 * MINUTE_IN_SECONDS );
	d4u_back( sprintf( 'Stock updated for %d dawa4u medicines.', count( $stock ) ) . ( $missed ? sprintf( ' %d lines in your file are not on dawa4u (listed below) — that’s fine.', count( $missed ) ) : '' ), 'ok' );
}

/* ------------------------------------------------------------------ the "Billing software" screen */

function d4u_ph_copybox( $text, $label = 'Copy' ) {
	return '<div class="d4p-copy"><code>' . esc_html( $text ) . '</code><button type="button" class="d4u-btn d4u-btn--ghost d4p-copy__btn" data-copy="' . esc_attr( $text ) . '">' . esc_html( $label ) . '</button></div>';
}

function d4u_ph_when( $ts ) {
	return $ts ? date_i18n( 'j M Y, g:i a', (int) $ts ) : '';
}

function d4u_ph_view_connect( $uid, $boss ) {
	$out = d4u_ph_view_head( 'Billing software', 'Connect Marg ERP, Busy, Tally, GoFrugal or any pharmacy billing software to dawa4u.' );

	$tz    = wp_timezone();
	$today = ( new DateTime( 'today', $tz ) )->format( 'Y-m-d' );
	$week  = ( new DateTime( 'today -6 days', $tz ) )->format( 'Y-m-d' );
	$dl    = '<form method="get" class="d4p-dl" action="' . esc_url( d4u_ph_url() ) . '"><input type="hidden" name="d4u_export" value="orders"><input type="hidden" name="_wpnonce" value="' . esc_attr( wp_create_nonce( 'd4u_export' ) ) . '">';
	$dl   .= '<label class="d4u-field"><span>From</span><input type="date" name="from" value="' . esc_attr( $week ) . '" max="' . esc_attr( $today ) . '"></label>';
	$dl   .= '<label class="d4u-field"><span>To</span><input type="date" name="to" value="' . esc_attr( $today ) . '" max="' . esc_attr( $today ) . '"></label>';
	$dl   .= '<button class="d4u-btn" type="submit">Download orders (CSV)</button></form>';

	if ( $boss ) {
		$out .= '<div class="d4p-conn"><section class="d4u-card d4p-conn__card"><h3>All orders as a spreadsheet</h3><p class="d4u-small">Every pharmacy’s orders, one line per medicine, with a Pharmacy column. Opens in Excel or Google Sheets.</p>' . $dl . '</section>';
		$out .= '<section class="d4u-card d4p-conn__card"><h3>Pharmacy links</h3><p class="d4u-small">Each pharmacy makes its own API key, alert address and stock upload on this screen when it logs in. Keys belong to one pharmacy and only see that pharmacy’s orders. The API lives at <code>' . esc_html( rest_url( D4U_API_NS . '/' ) ) . '</code>.</p></section></div>';
		return $out;
	}

	// How it fits together, in plain words.
	$out .= '<div class="d4u-card d4p-conn__intro"><p><strong>Marg ERP doesn’t offer an open connection</strong> that other apps can plug into. So there are three ways to link it — pick what suits you:</p><ol>';
	$out .= '<li><strong>Orders → Marg:</strong> download your dawa4u orders as a spreadsheet and bring them into Marg with its Excel import, or type the bill from it.</li>';
	$out .= '<li><strong>Stock → dawa4u:</strong> export your stock from Marg as Excel/CSV and upload it here. You then see “in stock” next to every order.</li>';
	$out .= '<li><strong>Automatic link:</strong> give the API key below to Marg’s support team or your software company. Their software can then pick up new orders, mark them packed with your bill number, and send your stock — by itself.</li>';
	$out .= '</ol></div>';

	$out .= '<div class="d4p-conn">';

	/* 1. orders out */
	$out .= '<section class="d4u-card d4p-conn__card"><span class="d4p-conn__n">1</span><h3>Download orders</h3>';
	$out .= '<p class="d4u-small">One line per medicine: date, order no., customer, phone, address, item code, medicine, qty, MRP, amount, payment and your bill no. Opens in Excel. In Marg, use the import from Excel option for sale orders/bills, or ask Marg support to map these columns once.</p>' . $dl;
	$out .= '<p class="d4u-small d4p-mute">Tip: when you pack an order, type your Marg bill number in the “Your bill no.” box. It appears in this file and on the order.</p></section>';

	/* 2. stock in */
	$stock = d4u_stock( $uid );
	$at    = (int) get_user_meta( $uid, 'd4u_stock_at', true );
	$src   = (string) get_user_meta( $uid, 'd4u_stock_src', true );
	$in    = 0;
	foreach ( $stock as $s ) {
		$in += $s['qty'] > 0 ? 1 : 0;
	}
	$out .= '<section class="d4u-card d4p-conn__card"><span class="d4p-conn__n">2</span><h3>Update your stock</h3>';
	if ( $at && ! d4u_stock_fresh( $uid ) ) {
		$out .= '<p class="d4p-conn__status"><span class="d4p-dot is-old"></span>' . esc_html( sprintf( 'Stock is older than %d days, so it isn’t used', D4U_STOCK_DAYS ) ) . ' <span class="d4p-mute">· last updated ' . esc_html( d4u_ph_when( $at ) ) . '</span></p>';
	} elseif ( $at ) {
		$out .= '<p class="d4p-conn__status"><span class="d4p-dot is-on"></span>' . esc_html( sprintf( '%d of %d dawa4u medicines in stock', $in, count( d4u_sellable_products() ) ) ) . ' <span class="d4p-mute">· updated ' . esc_html( d4u_ph_when( $at ) ) . ( 'api' === $src ? ' by your software' : ' from a file' ) . '</span></p>';
	} else {
		$out .= '<p class="d4p-conn__status"><span class="d4p-dot"></span>No stock uploaded yet</p>';
	}
	$out .= '<p class="d4u-small"><strong>Why it matters:</strong> when a customer orders, dawa4u checks every pharmacy that delivers to them and sends the order to one that has the medicines in stock. Upload at least once a day (stock older than ' . (int) D4U_STOCK_DAYS . ' days is ignored), or link your software below to keep it current.</p>';
	$out .= '<p class="d4u-small">In Marg: Reports → Stock → export to Excel. Any file with an item name (or our item code) and a stock/qty column works — several batches of one medicine are added up. Uploading replaces the old stock.</p>';
	$out .= d4u_form_open( 'ph_stock', 'd4p-upload', true ) . '<input type="hidden" name="op" value="upload"><label class="d4u-field"><span>Stock file (CSV or Excel .xlsx)</span><input type="file" name="stock" accept=".csv,.xlsx,.xls,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><button class="d4u-btn" type="submit">Upload stock</button></form>';
	$out .= '<p class="d4u-small"><a href="' . esc_url( d4u_export_url( 'stock_template' ) ) . '">Download the stock template</a> (all dawa4u medicines with item codes' . ( $stock ? ' and your current stock' : '' ) . ')</p>';
	$missed = get_transient( 'd4u_stockmiss_' . $uid );
	if ( is_array( $missed ) && $missed ) {
		delete_transient( 'd4u_stockmiss_' . $uid );
		$out .= '<details class="d4p-miss"><summary>' . esc_html( count( $missed ) ) . ' lines didn’t match a dawa4u medicine</summary><p class="d4u-small d4p-mute">Medicines we don’t list yet, or names written differently. To match one, put its item code (from the template) in an “Item code” column.</p><p class="d4u-small">' . esc_html( implode( ' · ', array_slice( $missed, 0, 120 ) ) ) . ( count( $missed ) > 120 ? ' …' : '' ) . '</p></details>';
	}
	if ( $stock ) {
		$out .= d4u_form_open( 'ph_stock', 'd4u-inline' ) . '<input type="hidden" name="op" value="clear"><button class="d4p-link" type="submit">Clear stock</button></form>';
	}
	$out .= '</section>';

	/* 3. API key */
	$key  = get_user_meta( $uid, 'd4u_api_key', true );
	$new  = get_transient( 'd4u_newkey_' . $uid );
	$used = (int) get_user_meta( $uid, 'd4u_api_used', true );
	$base = rest_url( D4U_API_NS . '/' );
	$out .= '<section class="d4u-card d4p-conn__card d4p-conn__card--wide"><span class="d4p-conn__n">3</span><h3>Automatic link (API key)</h3>';
	if ( $new ) {
		delete_transient( 'd4u_newkey_' . $uid );
		$out .= '<div class="d4p-keynew" data-d4p-stay><p><strong>Your API key</strong> — copy it now and give it only to your software company. It won’t be shown again.</p>' . d4u_ph_copybox( $new, 'Copy key' ) . '</div>';
	}
	if ( is_array( $key ) ) {
		$out .= '<p class="d4p-conn__status"><span class="d4p-dot is-on"></span>Key on — ends in <code>…' . esc_html( $key['last4'] ) . '</code> <span class="d4p-mute">· made ' . esc_html( d4u_ph_when( $key['created'] ) ) . ' · ' . ( $used ? 'last used ' . esc_html( d4u_ph_when( $used ) ) : 'not used yet' ) . '</span></p>';
		$out .= '<div class="d4p-row-btns">' . d4u_form_open( 'ph_key', 'd4u-inline' ) . '<input type="hidden" name="op" value="make"><button class="d4u-btn d4u-btn--ghost" type="submit">Make a new key</button></form>';
		$out .= d4u_form_open( 'ph_key', 'd4u-inline' ) . '<input type="hidden" name="op" value="off"><button class="d4u-btn d4u-btn--ghost d4p-danger" type="submit">Turn off</button></form></div>';
		$out .= '<p class="d4u-small d4p-mute">A new key stops the old one at once. Lost it, or someone left? Make a new key.</p>';
	} else {
		$out .= '<p class="d4p-conn__status"><span class="d4p-dot"></span>No key yet</p>';
		$out .= d4u_form_open( 'ph_key', 'd4u-inline' ) . '<input type="hidden" name="op" value="make"><button class="d4u-btn" type="submit">Make an API key</button></form>';
	}

	$out .= '<h4>For your software company</h4>';
	$out .= '<p class="d4u-small">Address: </p>' . d4u_ph_copybox( $base, 'Copy' );
	$out .= '<p class="d4u-small">Send the key in the <code>X-Dawa4u-Key</code> header on every request. Answers are JSON.</p>';
	$out .= '<div class="d4p-tablewrap"><table class="d4p-table d4p-api"><thead><tr><th>Request</th><th>What it does</th></tr></thead><tbody>';
	$rows = array(
		array( 'GET orders', 'Open orders. <code>?status=</code> open · to_check · to_pack · request · with_rider · delivered · cancelled · all. <code>?since=</code> date/time: only orders changed since then (for checking every minute).' ),
		array( 'GET orders/{id}', 'One order: customer, address, PIN, items with item code, qty, MRP, amount, payment, your stock.' ),
		array( 'POST orders/{id}/packed', 'Mark packed and ready for the rider. Body <code>{"bill_no":"A-1043"}</code> (optional).' ),
		array( 'POST orders/{id}/prescription', 'Body <code>{"decision":"approve"}</code> or <code>{"decision":"reject","reason":"…"}</code>. The pharmacist must have read the prescription.' ),
		array( 'POST orders/{id}/pass', 'You don’t have the medicines: the order goes to the next pharmacy near the customer. Body <code>{"reason":"…"}</code> (optional).' ),
		array( 'GET medicines', 'All dawa4u medicines with item code, contents, pack, MRP, Rx and your stock.' ),
		array( 'GET / POST stock', 'Read or send stock. Body <code>{"items":[{"sku":"d4u-…","qty":12}],"replace":false}</code>.' ),
		array( 'GET me', 'Your shop name, PIN codes and order counts — to test the key.' ),
	);
	foreach ( $rows as $r ) {
		$out .= '<tr><td><code>' . esc_html( $r[0] ) . '</code></td><td>' . wp_kses( $r[1], array( 'code' => array() ) ) . '</td></tr>';
	}
	$out .= '</tbody></table></div>';
	$out .= '<p class="d4u-small">Example:</p>' . d4u_ph_copybox( 'curl -H "X-Dawa4u-Key: YOUR_KEY" "' . $base . 'orders?status=to_pack"', 'Copy' );

	$msg  = "Hello,\n\nWe sell on dawa4u (dawa4u.in), an online medicine delivery service. We would like our billing software to pick up dawa4u orders automatically.\n\n";
	$msg .= 'dawa4u has a REST API (JSON): ' . $base . "\n";
	$msg .= "- Login: our API key in the X-Dawa4u-Key header (we will share the key separately).\n";
	$msg .= "- GET orders?status=to_pack&since=<time> — new orders with item codes, qty, MRP, customer and address.\n";
	$msg .= "- POST orders/{id}/packed with {\"bill_no\": \"...\"} — after billing.\n";
	$msg .= "- GET medicines — dawa4u item codes, to map to your item master.\n";
	$msg .= "- POST stock with {\"items\":[{\"sku\":\"...\",\"qty\":0}]} — our stock.\n";
	$msg .= "- Optional: dawa4u can POST each new order to your server (signed with HMAC-SHA256).\n\nCan you set this up for us?\n\nThank you,\n" . d4u_partner_name( $uid );
	$out .= '<details class="d4p-miss"><summary>Message to send Marg support or your software company</summary><textarea class="d4p-msg" readonly rows="14">' . esc_textarea( $msg ) . '</textarea><button type="button" class="d4u-btn d4u-btn--ghost" data-copy="' . esc_attr( $msg ) . '">Copy message</button></details>';
	$out .= '</section>';

	/* 4. webhook */
	$hook   = (string) get_user_meta( $uid, 'd4u_hook_url', true );
	$secret = get_transient( 'd4u_newsecret_' . $uid );
	$out   .= '<section class="d4u-card d4p-conn__card d4p-conn__card--wide"><span class="d4p-conn__n">4</span><h3>Instant new-order alerts (webhook)</h3>';
	$out   .= '<p class="d4u-small">Optional, for software companies: dawa4u sends each order to this address the moment it arrives or changes (new prescription to check, new order to pack, picked up, delivered, cancelled), so their software doesn’t have to keep asking.</p>';
	if ( $secret ) {
		delete_transient( 'd4u_newsecret_' . $uid );
		$out .= '<div class="d4p-keynew" data-d4p-stay><p><strong>Signing secret</strong> — give it to your software company with the key. It won’t be shown again.</p>' . d4u_ph_copybox( $secret, 'Copy secret' ) . '</div>';
	}
	$out .= d4u_form_open( 'ph_hook', 'd4p-hook' ) . '<input type="hidden" name="op" value="save"><label class="d4u-field"><span>Alert address (https://…)</span><input type="url" name="url" value="' . esc_attr( $hook ) . '" placeholder="https://your-software.com/dawa4u" pattern="https://.*" required></label>';
	$out .= '<button class="d4u-btn" type="submit">' . ( $hook ? 'Save address' : 'Turn on alerts' ) . '</button></form>';
	if ( $hook ) {
		$out .= '<div class="d4p-row-btns">' . d4u_form_open( 'ph_hook', 'd4u-inline' ) . '<input type="hidden" name="op" value="test"><button class="d4u-btn d4u-btn--ghost" type="submit">Send a test alert</button></form>';
		$out .= d4u_form_open( 'ph_hook', 'd4u-inline' ) . '<input type="hidden" name="op" value="save"><input type="hidden" name="url" value="' . esc_attr( $hook ) . '"><input type="hidden" name="new_secret" value="1"><button class="d4u-btn d4u-btn--ghost" type="submit">New secret</button></form>';
		$out .= d4u_form_open( 'ph_hook', 'd4u-inline' ) . '<input type="hidden" name="op" value="off"><button class="d4u-btn d4u-btn--ghost d4p-danger" type="submit">Turn off</button></form></div>';
	}
	$out .= '<p class="d4u-small d4p-mute">Each alert is a JSON POST with <code>event</code> (e.g. <code>order.to_pack</code>) and the full <code>order</code>. Header <code>X-Dawa4u-Signature: sha256=…</code> is the HMAC-SHA256 of the body with the signing secret.</p>';
	$out .= '</section></div>';
	return $out;
}
