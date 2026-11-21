<?php
/**
 * All WooCommerce pages (medicine list, groups, search, single medicine) use this wrapper.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
get_header(); ?>
<div class="d4-woo">
	<?php woocommerce_content(); ?>
</div>
<?php
get_footer();
