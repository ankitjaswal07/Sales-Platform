<?php
/**
 * Plugin Name:       LeadForge Connector
 * Plugin URI:        https://github.com/ankitjaswal07/Sales-Platform
 * Description:       Launches your LeadForge workspace from WordPress: a signed one-click sign-in, an embeddable shortcode, and a dashboard widget that reports live workspace status. LeadForge itself runs as a separate Node.js app — this plugin is the bridge, not the app.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            LeadForge
 * License:           Apache-2.0
 * License URI:       https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain:       leadforge-connector
 *
 * @package LeadForge_Connector
 */

// Never allow direct access: every file in this plugin starts with this guard.
defined( 'ABSPATH' ) || exit;

define( 'LEADFORGE_CONNECTOR_VERSION', '1.0.0' );
define( 'LEADFORGE_CONNECTOR_FILE', __FILE__ );
define( 'LEADFORGE_CONNECTOR_DIR', plugin_dir_path( __FILE__ ) );
define( 'LEADFORGE_CONNECTOR_URL', plugin_dir_url( __FILE__ ) );

// Signed links are only valid for a short window; keep this in step with
// LAUNCH_TTL_SECONDS in the LeadForge app (src/lib/api/connector.ts).
define( 'LEADFORGE_LAUNCH_TTL', 180 );

require_once LEADFORGE_CONNECTOR_DIR . 'includes/class-leadforge-signer.php';
require_once LEADFORGE_CONNECTOR_DIR . 'includes/class-leadforge-settings.php';
require_once LEADFORGE_CONNECTOR_DIR . 'includes/class-leadforge-api.php';
require_once LEADFORGE_CONNECTOR_DIR . 'includes/class-leadforge-shortcode.php';
require_once LEADFORGE_CONNECTOR_DIR . 'includes/class-leadforge-widget.php';

/**
 * Boot the plugin.
 */
function leadforge_connector_init() {
	load_plugin_textdomain( 'leadforge-connector', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );

	LeadForge_Settings::instance()->hooks();
	LeadForge_Shortcode::instance()->hooks();

	if ( is_admin() ) {
		LeadForge_Widget::instance()->hooks();
	}
}
add_action( 'plugins_loaded', 'leadforge_connector_init' );

/**
 * Activation: record the plugin version and refuse nothing silently.
 *
 * We do not create database tables or options that pretend to be a connection —
 * the settings screen states plainly whether a workspace has been configured.
 */
function leadforge_connector_activate() {
	if ( ! get_option( 'leadforge_connector_version' ) ) {
		add_option( 'leadforge_connector_version', LEADFORGE_CONNECTOR_VERSION );
	}
	update_option( 'leadforge_connector_version', LEADFORGE_CONNECTOR_VERSION );
}
register_activation_hook( __FILE__, 'leadforge_connector_activate' );

/**
 * Add a top-level admin menu that simply launches the workspace.
 */
function leadforge_connector_admin_menu() {
	$settings = LeadForge_Settings::instance();

	$launch_url = $settings->is_configured() ? $settings->launch_url( 'wordpress-admin' ) : $settings->admin_url();

	add_menu_page(
		__( 'LeadForge', 'leadforge-connector' ),
		__( 'LeadForge', 'leadforge-connector' ),
		'read',
		'leadforge-connector',
		'leadforge_connector_render_launch_page',
		'dashicons-chart-line',
		58
	);

	// The menu itself points at the launch page; the submenu adds configuration.
	add_submenu_page(
		'leadforge-connector',
		__( 'Open LeadForge', 'leadforge-connector' ),
		__( 'Open LeadForge', 'leadforge-connector' ),
		'read',
		'leadforge-connector',
		'leadforge_connector_render_launch_page'
	);

	add_submenu_page(
		'leadforge-connector',
		__( 'LeadForge settings', 'leadforge-connector' ),
		__( 'Settings', 'leadforge-connector' ),
		'manage_options',
		'leadforge-connector-settings',
		array( $settings, 'render_page' )
	);

	// Store the prepared launch URL so the menu markup can use it directly.
	$settings->prime_launch_url( $launch_url );
}
add_action( 'admin_menu', 'leadforge_connector_admin_menu' );

/**
 * The "Open LeadForge" screen: one button, plus an honest status panel.
 */
function leadforge_connector_render_launch_page() {
	$settings   = LeadForge_Settings::instance();
	$configured = $settings->is_configured();

	// Optional shortcut: skip the in-between page and go straight to the app.
	if ( $configured && $settings->get( 'menu_opens_app' ) ) {
		$target = $settings->launch_url( 'admin-menu' );
		if ( $target ) {
			wp_safe_redirect( $target );
			exit;
		}
	}
	?>
	<div class="wrap leadforge-wrap">
		<h1><?php esc_html_e( 'LeadForge', 'leadforge-connector' ); ?></h1>

		<?php if ( ! $configured ) : ?>
			<div class="notice notice-warning">
				<p>
					<strong><?php esc_html_e( 'No workspace configured yet.', 'leadforge-connector' ); ?></strong>
					<?php esc_html_e( 'Enter your LeadForge URL and shared secret to enable one-click sign-in.', 'leadforge-connector' ); ?>
				</p>
				<p>
					<a class="button button-primary" href="<?php echo esc_url( $settings->admin_url() ); ?>">
						<?php esc_html_e( 'Open settings', 'leadforge-connector' ); ?>
					</a>
				</p>
			</div>
		<?php else : ?>
			<p class="leadforge-lead">
				<?php
				printf(
					/* translators: %s: the LeadForge workspace URL. */
					esc_html__( 'Your workspace is configured at %s. Opening it signs you in automatically using a single-use, signed link — no password is ever sent between WordPress and LeadForge.', 'leadforge-connector' ),
					'<code>' . esc_html( $settings->base_url() ) . '</code>'
				);
				?>
			</p>
			<p>
				<a class="button button-primary button-hero" href="<?php echo esc_url( $settings->launch_url( 'launch-page' ) ); ?>">
					<?php esc_html_e( 'Open LeadForge', 'leadforge-connector' ); ?>
				</a>
			</p>
			<?php
			$status = LeadForge_Api::instance()->fetch_status();
			LeadForge_Settings::render_status_box( $status );
			?>
		<?php endif; ?>
	</div>
	<?php
}

/**
 * "Settings" link on the plugins list, for convenience.
 *
 * @param array $links Existing action links.
 * @return array
 */
function leadforge_connector_action_links( $links ) {
	$url = admin_url( 'admin.php?page=leadforge-connector-settings' );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'leadforge-connector' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'leadforge_connector_action_links' );

/**
 * Load the small amount of admin styling needed by our screens only.
 *
 * @param string $hook Current admin page hook.
 */
function leadforge_connector_admin_assets( $hook ) {
	if ( false === strpos( $hook, 'leadforge-connector' ) ) {
		return;
	}
	wp_enqueue_style(
		'leadforge-connector-admin',
		LEADFORGE_CONNECTOR_URL . 'assets/admin.css',
		array(),
		LEADFORGE_CONNECTOR_VERSION
	);
}
add_action( 'admin_enqueue_scripts', 'leadforge_connector_admin_assets' );
