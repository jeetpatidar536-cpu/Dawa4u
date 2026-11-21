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
        <li><a href="<?php echo dawa4u_app( 'shop/' ); // phpcs:ignore ?>">Shop online</a></li>
        <li><a href="<?php echo dawa4u_app( 'app/' ); // phpcs:ignore ?>">Customer app</a></li>
        <li><a href="<?php echo dawa4u_app( 'shop/#/rx' ); // phpcs:ignore ?>">Upload prescription</a></li>
        <li><a href="<?php echo dawa4u_app( 'pharmacy/' ); // phpcs:ignore ?>">Pharmacy login</a></li>
        <li><a href="<?php echo dawa4u_app( 'rider/' ); // phpcs:ignore ?>">Rider login</a></li>
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
