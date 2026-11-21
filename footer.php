<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
</main>
<footer class="d4-footer">
  <div class="d4-footer__in">
    <div>
      <a class="d4-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php echo dawa4u_logo( 30 ); // phpcs:ignore ?><span>dawa<b>4u</b></span></a>
      <p>Medicines from licensed partner pharmacies, delivered by local riders in 10–15 minutes. Prescription medicines are dispensed only after a licensed pharmacist checks your prescription.</p>
    </div>
    <div>
      <h4>Order</h4>
      <ul>
        <li><a href="<?php echo esc_url( dawa4u_url( 'shop' ) ); ?>">Medicines</a></li>
        <li><a href="<?php echo esc_url( dawa4u_url( 'rx' ) ); ?>">Upload prescription</a></li>
        <li><a href="<?php echo esc_url( dawa4u_url( 'account' ) ); ?>">My account</a></li>
        <li><a href="<?php echo esc_url( dawa4u_url( 'pharmacy' ) ); ?>">Pharmacy login</a></li>
        <li><a href="<?php echo esc_url( dawa4u_url( 'rider' ) ); ?>">Rider login</a></li>
      </ul>
    </div>
    <div>
      <h4>dawa4u</h4>
      <?php wp_nav_menu( array( 'theme_location' => 'footer', 'container' => false, 'depth' => 1, 'fallback_cb' => 'dawa4u_fallback_menu' ) ); ?>
    </div>
  </div>
  <div class="d4-footer__base">© <?php echo esc_html( gmdate( 'Y' ) ); ?> dawa4u · All prices in ₹ (INR)</div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
