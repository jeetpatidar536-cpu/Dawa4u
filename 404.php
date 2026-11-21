<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
get_header(); ?>
<h1 class="d4-page-title">Page not found</h1>
<div class="entry-content">
	<p>This page doesn't exist. You can still order your medicines.</p>
	<div class="wp-block-buttons"><div class="wp-block-button d4-gold"><a class="wp-block-button__link wp-element-button" href="<?php echo dawa4u_app( 'shop/' ); // phpcs:ignore ?>">Order medicines</a></div>
	<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/' ) ); ?>">Go home</a></div></div>
</div>
<?php get_footer();
