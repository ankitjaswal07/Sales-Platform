<?php
/**
 * WordPress dashboard widget.
 *
 * Shows the real state of the workspace: whether the app answers at all, and if
 * so, how many leads, hot leads and proposals the team is working with. When
 * anything is wrong it says so instead of rendering zeros that look like data.
 *
 * @package LeadForge_Connector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the dashboard widget.
 */
class LeadForge_Widget {

	/**
	 * Singleton instance.
	 *
	 * @var LeadForge_Widget|null
	 */
	private static $instance = null;

	/**
	 * Get the singleton.
	 *
	 * @return LeadForge_Widget
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
		add_action( 'wp_dashboard_setup', array( $this, 'register' ) );
	}

	/**
	 * Add the widget when it is enabled and the user may see it.
	 */
	public function register() {
		$settings = LeadForge_Settings::instance();

		if ( ! $settings->get( 'show_widget' ) ) {
			return;
		}
		// Only for people who can actually use the workspace.
		if ( ! current_user_can( 'read' ) ) {
			return;
		}

		wp_add_dashboard_widget(
			'leadforge_status_widget',
			__( 'LeadForge', 'leadforge-connector' ),
			array( $this, 'render' )
		);
	}

	/**
	 * Render the widget body.
	 */
	public function render() {
		$settings = LeadForge_Settings::instance();

		if ( ! $settings->is_configured() ) {
			printf(
				'<p>%1$s</p><p><a class="button button-primary" href="%2$s">%3$s</a></p>',
				esc_html__( 'LeadForge is not connected yet.', 'leadforge-connector' ),
				esc_url( $settings->admin_url() ),
				esc_html__( 'Configure the connector', 'leadforge-connector' )
			);
			return;
		}

		$health = LeadForge_Api::instance()->fetch_health();
		$status = LeadForge_Api::instance()->fetch_status();

		?>
		<div class="leadforge-widget">
			<?php if ( ! $health || empty( $health['reachable'] ) || empty( $health['body']['status'] ) || 'ok' !== $health['body']['status'] ) : ?>
				<p class="leadforge-state is-error">
					<span class="leadforge-dot"></span>
					<?php
					printf(
						/* translators: %s: error message. */
						esc_html__( 'The workspace is not answering: %s', 'leadforge-connector' ),
						esc_html( isset( $health['error'] ) ? $health['error'] : __( 'unexpected health response', 'leadforge-connector' ) )
					);
					?>
				</p>
			<?php elseif ( empty( $status['ok'] ) ) : ?>
				<p class="leadforge-state is-warning">
					<span class="leadforge-dot"></span>
					<?php
					printf(
						/* translators: %s: error message. */
						esc_html__( 'Running, but signed requests are failing: %s', 'leadforge-connector' ),
						esc_html( isset( $status['error'] ) ? $status['error'] : __( 'no response', 'leadforge-connector' ) )
					);
					?>
				</p>
			<?php else : ?>
				<?php $counts = isset( $status['counts'] ) ? $status['counts'] : array(); ?>
				<ul class="leadforge-stats">
					<li>
						<strong><?php echo esc_html( isset( $counts['leads'] ) ? $counts['leads'] : 0 ); ?></strong>
						<?php esc_html_e( 'leads', 'leadforge-connector' ); ?>
					</li>
					<li>
						<strong><?php echo esc_html( isset( $counts['hotLeads'] ) ? $counts['hotLeads'] : 0 ); ?></strong>
						<?php esc_html_e( 'hot', 'leadforge-connector' ); ?>
					</li>
					<li>
						<strong><?php echo esc_html( isset( $counts['uncontacted'] ) ? $counts['uncontacted'] : 0 ); ?></strong>
						<?php esc_html_e( 'never contacted', 'leadforge-connector' ); ?>
					</li>
					<li>
						<strong><?php echo esc_html( isset( $counts['proposalsSent'] ) ? $counts['proposalsSent'] : 0 ); ?></strong>
						<?php esc_html_e( 'proposals out', 'leadforge-connector' ); ?>
					</li>
				</ul>

				<?php if ( ! empty( $status['opportunity']['highOpportunity'] ) ) : ?>
					<p class="description">
						<?php
						printf(
							/* translators: %d: number of businesses with weak websites. */
							esc_html__( '%d businesses in this workspace have a website worth pitching against.', 'leadforge-connector' ),
							(int) $status['opportunity']['highOpportunity']
						);
						?>
					</p>
				<?php endif; ?>
			<?php endif; ?>

			<p>
				<a class="button button-primary" href="<?php echo esc_url( $settings->launch_url( 'dashboard-widget' ) ); ?>">
					<?php esc_html_e( 'Open LeadForge', 'leadforge-connector' ); ?>
				</a>
			</p>
			<p class="description">
				<?php esc_html_e( 'Counts come from the workspace itself. Nothing is estimated.', 'leadforge-connector' ); ?>
			</p>
		</div>
		<?php
	}
}
