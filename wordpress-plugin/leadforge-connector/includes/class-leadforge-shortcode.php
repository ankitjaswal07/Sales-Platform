<?php
/**
 * Shortcodes: [leadforge_link] and [leadforge].
 *
 * Both degrade honestly: with no workspace configured they render a short
 * explanation rather than an empty iframe or a broken link, and only users who
 * can edit content see that explanation.
 *
 * @package LeadForge_Connector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the plugin's shortcodes.
 */
class LeadForge_Shortcode {

	/**
	 * Singleton instance.
	 *
	 * @var LeadForge_Shortcode|null
	 */
	private static $instance = null;

	/**
	 * Get the singleton.
	 *
	 * @return LeadForge_Shortcode
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register hooks.
	 */
	public function hooks() {
		add_shortcode( 'leadforge_link', array( $this, 'render_link' ) );
		add_shortcode( 'leadforge', array( $this, 'render_embed' ) );
	}

	/**
	 * [leadforge_link label="Open LeadForge" class="button" target="_self"]
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string
	 */
	public function render_link( $atts ) {
		$settings = LeadForge_Settings::instance();
		$atts     = shortcode_atts(
			array(
				'label'  => __( 'Open LeadForge', 'leadforge-connector' ),
				'class'  => 'leadforge-button',
				'target' => '_self',
				'path'   => '/dashboard',
			),
			$atts,
			'leadforge_link'
		);

		if ( ! $settings->is_configured() ) {
			return $this->not_configured_notice();
		}

		$url   = $settings->launch_url( 'shortcode-link' );
		$class = sanitize_html_class( $atts['class'] );
		$rel   = '_blank' === $atts['target'] ? ' rel="noopener noreferrer"' : '';

		return sprintf(
			'<a class="%1$s" href="%2$s" target="%3$s"%4$s>%5$s</a>',
			esc_attr( $class ),
			esc_url( $url ),
			esc_attr( '_blank' === $atts['target'] ? '_blank' : '_self' ),
			$rel,
			esc_html( $atts['label'] )
		);
	}

	/**
	 * [leadforge height="900" path="/dashboard" title="LeadForge"]
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string
	 */
	public function render_embed( $atts ) {
		$settings = LeadForge_Settings::instance();
		$atts     = shortcode_atts(
			array(
				'height' => (string) $settings->get( 'default_height' ),
				'path'   => '/dashboard',
				'title'  => __( 'LeadForge', 'leadforge-connector' ),
				'width'  => '100%',
			),
			$atts,
			'leadforge'
		);

		if ( ! $settings->is_configured() ) {
			return $this->not_configured_notice();
		}

		// Only ever iframe the configured workspace: never an arbitrary URL.
		$path = '/' . ltrim( (string) $atts['path'], '/' );
		if ( false !== strpos( $path, '//' ) ) {
			$path = '/dashboard';
		}
		$src = $settings->base_url() . $path;

		$height = absint( $atts['height'] );
		if ( $height < 200 || $height > 4000 ) {
			$height = (int) $settings->get( 'default_height' );
		}
		$width = preg_match( '/^\d{1,4}(px|%)$/', (string) $atts['width'] ) ? (string) $atts['width'] : '100%';

		return sprintf(
			'<iframe class="leadforge-embed" src="%1$s" title="%2$s" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="width:%3$s;height:%4$dpx;border:0;border-radius:12px;background:transparent"></iframe>',
			esc_url( $src ),
			esc_attr( $atts['title'] ),
			esc_attr( $width ),
			(int) $height
		);
	}

	/**
	 * What to show when the plugin has not been pointed at a workspace.
	 *
	 * Visitors see nothing; editors see why.
	 *
	 * @return string
	 */
	private function not_configured_notice() {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return '';
		}
		return '<div class="leadforge-notice">' . esc_html__(
			'LeadForge is not connected yet. An administrator needs to set the workspace URL and shared secret in Settings → LeadForge Connector.',
			'leadforge-connector'
		) . '</div>';
	}
}
