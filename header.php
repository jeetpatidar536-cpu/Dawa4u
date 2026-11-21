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
    <?php echo dawa4u_cart_link(); // phpcs:ignore -- escaped inside ?>
    <a class="d4-acct" href="<?php echo esc_url( dawa4u_url( 'account' ) ); ?>" aria-label="<?php echo is_user_logged_in() ? 'My account' : 'Log in'; ?>"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></a>
    <a class="d4-cta" href="<?php echo esc_url( dawa4u_url( 'shop' ) ); ?>">Order now</a>
    <nav class="d4-nav" aria-label="Main">
      <?php wp_nav_menu( array( 'theme_location' => 'primary', 'container' => false, 'depth' => 1, 'fallback_cb' => 'dawa4u_fallback_menu' ) ); ?>
    </nav>
  </div>
</header>
<main id="content" class="d4-main">
