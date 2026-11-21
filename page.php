<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
get_header();
while ( have_posts() ) :
	the_post(); ?>
	<article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
		<?php if ( ! is_front_page() ) : ?><h1 class="d4-page-title"><?php the_title(); ?></h1><?php endif; ?>
		<div class="entry-content"><?php the_content(); ?></div>
	</article>
<?php endwhile;
get_footer();
