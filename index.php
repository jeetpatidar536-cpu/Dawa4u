<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
get_header();
if ( is_singular() ) :
	while ( have_posts() ) :
		the_post(); ?>
		<article <?php post_class(); ?>>
			<h1 class="d4-page-title"><?php the_title(); ?></h1>
			<div class="entry-content"><?php the_content(); ?></div>
		</article>
	<?php endwhile;
else : ?>
	<h1 class="d4-page-title"><?php echo is_search() ? esc_html__( 'Search results', 'dawa4u' ) : esc_html( wp_strip_all_tags( get_the_archive_title() ?: __( 'News', 'dawa4u' ) ) ); ?></h1>
	<?php if ( have_posts() ) :
		while ( have_posts() ) :
			the_post(); ?>
			<div class="d4-post">
				<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
				<div class="entry-content"><?php the_excerpt(); ?></div>
			</div>
		<?php endwhile;
		the_posts_pagination();
	else : ?>
		<p><?php esc_html_e( 'Nothing here yet.', 'dawa4u' ); ?></p>
	<?php endif;
endif;
get_footer();
