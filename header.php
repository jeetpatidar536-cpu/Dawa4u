<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="skip-link screen-reader-text" href="#content"><?php esc_html_e( 'Skip to content', 'dawa4u' ); ?></a>
<header class="d4-header">
  <div class="d4-header__in">
    <a class="d4-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" aria-label="dawa4u home"><?php echo dawa4u_logo( 34 ); // phpcs:ignore ?><span>dawa<b>4u</b></span></a>
    <input type="checkbox" id="d4-menu" class="d4-menu-toggle" aria-hidden="true">
    <label for="d4-menu" class="d4-menu-btn" aria-label="Menu"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></label>
    <button type="button" class="d4-theme" aria-label="Light or dark mode"></button>
    <a class="d4-cta" href="<?php echo dawa4u_app( 'shop/' ); // phpcs:ignore ?>">Order now</a>
    <nav class="d4-nav" aria-label="Main">
      <?php wp_nav_menu( array( 'theme_location' => 'primary', 'container' => false, 'depth' => 1, 'fallback_cb' => 'dawa4u_fallback_menu' ) ); ?>
    </nav>
  </div>
</header>
<main id="content" class="d4-main">
