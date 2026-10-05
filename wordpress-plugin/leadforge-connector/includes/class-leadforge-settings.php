<?php
/**
 * Settings screen and stored configuration.
 *
 * Deliberately small: a base URL, a shared secret, and two embed defaults.
 * Every field is validated before it is saved, and the screen reports the real
 * connection state rather than assuming the values work.
 *
 * @package LeadForge_Connector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Option handling and the settings UI.
 */
class LeadForge_Settings {

	const OPTION = 'leadforge_connector_settings';

	/**
	 * Singleton instance.
	 *
	 * @var LeadForge_Settings|null
	 */
	private static $instance = null;

	/**
	 * Prepared launch URL for the current request.
	 *
	 * @var string|null
	 */
	private $primed_launch_url = null;

	/**
	 * Get the singleton.
	 *
	 * @return LeadForge_Settings
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register WordPress hooks.
	 */
	public function hooks() {
		add_action( 'admin_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Register the option, its sanitisation callback and the settings sections.
	 */
	public function register_settings() {
		register_setting(
			'leadforge_connector',
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize' ),
				'default'           => $this->defaults(),
			)
		);
	}

	/**
	 * Default settings.
	 *
	 * @return array
	 */
	public function defaults() {
		return array(
			'base_url'        => '',
			'secret'          => '',
			'default_height'  => '900',
			'enable_sso'      => 1,
			'show_widget'     => 1,
			'menu_opens_app'  => 1,
		);
	}

	/**
	 * All settings merged with defaults.
	 *
	 * @return array
	 */
	public function all() {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		return wp_parse_args( $stored, $this->defaults() );
	}

	/**
	 * A single setting.
	 *
	 * @param string $key Setting key.
	 * @return mixed
	 */
	public function get( $key ) {
		$all = $this->all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/**
	 * Validate everything the user typed before it is stored.
	 *
	 * @param mixed $input Raw form input.
	 * @return array
	 */
	public function sanitize( $input ) {
		$defaults = $this->defaults();
		$output   = $defaults;

		if ( ! is_array( $input ) ) {
			return $output;
		}

		$raw_url = isset( $input['base_url'] ) ? trim( (string) $input['base_url'] ) : '';
		if ( '' !== $raw_url ) {
			// Accept a bare host too, but store a proper absolute URL.
			if ( ! preg_match( '#^https?://#i', $raw_url ) ) {
				$raw_url = 'https://' . ltrim( $raw_url, '/' );
			}
			$url = esc_url_raw( $raw_url, array( 'http', 'https' ) );
			if ( ! $url ) {
				add_settings_error(
					self::OPTION,
					'leadforge_base_url',
					__( 'That URL could not be parsed. Use something like https://app.example.com', 'leadforge-connector' ),
					'error'
				);
			} else {
				$output['base_url'] = untrailingslashit( $url );
			}
		}

		if ( isset( $input['secret'] ) ) {
			$secret = trim( (string) $input['secret'] );
			// A too-short secret is worse than none: it invites a false sense of security.
			if ( '' !== $secret && strlen( $secret ) < 24 ) {
				add_settings_error(
					self::OPTION,
					'leadforge_secret',
					__( 'The shared secret must be at least 24 characters. Use the same value as WORDPRESS_CONNECTOR_SECRET on the LeadForge server.', 'leadforge-connector' ),
					'error'
				);
				$secret = '';
			}
			$output['secret'] = $secret;
		}

		if ( isset( $input['default_height'] ) ) {
			$height                    = absint( $input['default_height'] );
			$output['default_height']  = ( $height >= 200 && $height <= 4000 ) ? (string) $height : $defaults['default_height'];
		}

		// Stored credentials changed, so previously cached results are stale.
		LeadForge_Api::instance()->flush_cache();

		$output['enable_sso']     = empty( $input['enable_sso'] ) ? 0 : 1;
		$output['show_widget']    = empty( $input['show_widget'] ) ? 0 : 1;
		$output['menu_opens_app'] = empty( $input['menu_opens_app'] ) ? 0 : 1;

		return $output;
	}

	/**
	 * Is there enough configuration to attempt a connection?
	 *
	 * @return bool
	 */
	public function is_configured() {
		$all = $this->all();
		return ! empty( $all['base_url'] ) && ! empty( $all['secret'] );
	}

	/**
	 * The configured workspace URL, without a trailing slash.
	 *
	 * @return string
	 */
	public function base_url() {
		return untrailingslashit( (string) $this->get( 'base_url' ) );
	}

	/**
	 * The shared secret.
	 *
	 * @return string
	 */
	public function secret() {
		return (string) $this->get( 'secret' );
	}

	/**
	 * URL of this plugin's settings screen.
	 *
	 * @return string
	 */
	public function admin_url() {
		return admin_url( 'admin.php?page=leadforge-connector-settings' );
	}

	/**
	 * Build a signed, single-use launch URL for a WordPress user.
	 *
	 * Falls back to the plain workspace URL when signing is disabled or not
	 * configured — never to a broken link.
	 *
	 * @param string $source Label recorded in the LeadForge audit log.
	 * @param int    $user_id Optional WordPress user ID; defaults to current user.
	 * @return string
	 */
	public function launch_url( $source = 'wordpress', $user_id = 0 ) {
		$base = $this->base_url();
		if ( ! $base ) {
			return '';
		}

		if ( ! $this->get( 'enable_sso' ) ) {
			return $base . '/dashboard';
		}

		$user = $user_id ? get_userdata( $user_id ) : wp_get_current_user();
		if ( ! $user || ! is_email( $user->user_email ) ) {
			return $base . '/dashboard';
		}

		$ts    = time();
		$nonce = LeadForge_Signer::nonce();
		$sig   = LeadForge_Signer::sign_launch( $this->secret(), $user->user_email, $ts, $nonce );

		return add_query_arg(
			array(
				'email'  => rawurlencode( $user->user_email ),
				'ts'     => $ts,
				'nonce'  => $nonce,
				'sig'    => $sig,
				'source' => rawurlencode( $source ),
				'next'   => '/dashboard',
			),
			$base . '/api/auth/sso'
		);
	}

	/**
	 * Cache the launch URL computed during admin_menu.
	 *
	 * @param string $url Prepared URL.
	 */
	public function prime_launch_url( $url ) {
		$this->primed_launch_url = $url;
	}

	/**
	 * The prepared URL, if one was primed.
	 *
	 * @return string|null
	 */
	public function primed_launch_url() {
		return $this->primed_launch_url;
	}

	/**
	 * Render the settings screen.
	 */
	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to view this page.', 'leadforge-connector' ) );
		}

		$all = $this->all();
		?>
		<div class="wrap leadforge-wrap">
			<h1><?php esc_html_e( 'LeadForge Connector settings', 'leadforge-connector' ); ?></h1>

			<p class="leadforge-lead">
				<?php esc_html_e( 'LeadForge runs as its own Node.js application — it cannot execute inside WordPress. This plugin connects to it: signed one-click sign-in, an embed shortcode, and a dashboard widget.', 'leadforge-connector' ); ?>
			</p>

			<?php settings_errors( self::OPTION ); ?>

			<form action="options.php" method="post">
				<?php settings_fields( 'leadforge_connector' ); ?>

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">
							<label for="leadforge-base-url"><?php esc_html_e( 'LeadForge URL', 'leadforge-connector' ); ?></label>
						</th>
						<td>
							<input
								type="url"
								id="leadforge-base-url"
								name="<?php echo esc_attr( self::OPTION ); ?>[base_url]"
								value="<?php echo esc_attr( $all['base_url'] ); ?>"
								class="regular-text code"
								placeholder="https://app.example.com"
							/>
							<p class="description">
								<?php esc_html_e( 'Address of your LeadForge instance, with no trailing slash. This must be a site that can run Node.js — see docs/DEPLOYMENT.md.', 'leadforge-connector' ); ?>
							</p>
						</td>
					</tr>

					<tr>
						<th scope="row">
							<label for="leadforge-secret"><?php esc_html_e( 'Shared secret', 'leadforge-connector' ); ?></label>
						</th>
						<td>
							<input
								type="password"
								id="leadforge-secret"
								name="<?php echo esc_attr( self::OPTION ); ?>[secret]"
								value="<?php echo esc_attr( $all['secret'] ); ?>"
								class="regular-text code"
								autocomplete="off"
							/>
							<p class="description">
								<?php esc_html_e( 'Must match WORDPRESS_CONNECTOR_SECRET in the LeadForge .env.local file. Generate one with: openssl rand -base64 32', 'leadforge-connector' ); ?>
							</p>
						</td>
					</tr>

					<tr>
						<th scope="row"><?php esc_html_e( 'Behaviour', 'leadforge-connector' ); ?></th>
						<td>
							<fieldset>
								<label>
									<input
										type="checkbox"
										name="<?php echo esc_attr( self::OPTION ); ?>[enable_sso]"
										value="1"
										<?php checked( 1, (int) $all['enable_sso'] ); ?>
									/>
									<?php esc_html_e( 'Sign users in automatically (single-use signed link, expires in 3 minutes)', 'leadforge-connector' ); ?>
								</label>
								<br />
								<label>
									<input
										type="checkbox"
										name="<?php echo esc_attr( self::OPTION ); ?>[show_widget]"
										value="1"
										<?php checked( 1, (int) $all['show_widget'] ); ?>
									/>
									<?php esc_html_e( 'Show the LeadForge dashboard widget', 'leadforge-connector' ); ?>
								</label>
								<br />
								<label>
									<input
										type="checkbox"
										name="<?php echo esc_attr( self::OPTION ); ?>[menu_opens_app]"
										value="1"
										<?php checked( 1, (int) $all['menu_opens_app'] ); ?>
									/>
									<?php esc_html_e( 'The admin menu opens LeadForge directly instead of an in-between page', 'leadforge-connector' ); ?>
								</label>
							</fieldset>
						</td>
					</tr>

					<tr>
						<th scope="row">
							<label for="leadforge-height"><?php esc_html_e( 'Embed height', 'leadforge-connector' ); ?></label>
						</th>
						<td>
							<input
								type="number"
								id="leadforge-height"
								name="<?php echo esc_attr( self::OPTION ); ?>[default_height]"
								value="<?php echo esc_attr( $all['default_height'] ); ?>"
								min="200"
								max="4000"
								step="10"
								class="small-text"
							/>
							<p class="description">
								<?php esc_html_e( 'Default pixel height for the [leadforge] shortcode. Can be overridden per page.', 'leadforge-connector' ); ?>
							</p>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>

			<?php $this->render_connection_state(); ?>
			<?php $this->render_shortcode_help(); ?>
		</div>
		<?php
	}

	/**
	 * Live connection test, so the screen reflects reality rather than hope.
	 */
	private function render_connection_state() {
		if ( ! $this->is_configured() ) {
			self::render_status_box( null );
			return;
		}

		$health = LeadForge_Api::instance()->fetch_health();
		$status = LeadForge_Api::instance()->fetch_status();
		?>
		<h2><?php esc_html_e( 'Connection', 'leadforge-connector' ); ?></h2>
		<?php
		self::render_health_box( $health );
		self::render_status_box( $status );
	}

	/**
	 * Health panel.
	 *
	 * @param array|null $health Result of LeadForge_Api::fetch_health().
	 */
	public static function render_health_box( $health ) {
		if ( null === $health ) {
			return;
		}
		$ok = ! empty( $health['reachable'] ) && isset( $health['body']['status'] ) && 'ok' === $health['body']['status'];
		?>
		<div class="leadforge-card <?php echo $ok ? 'is-ok' : 'is-error'; ?>">
			<h3><?php esc_html_e( 'Workspace health', 'leadforge-connector' ); ?></h3>
			<?php if ( ! empty( $health['reachable'] ) ) : ?>
				<p>
					<span class="leadforge-dot"></span>
					<?php
					printf(
						/* translators: %s: status string returned by the app. */
						esc_html__( 'GET /api/health answered "%s".', 'leadforge-connector' ),
						esc_html( isset( $health['body']['status'] ) ? $health['body']['status'] : 'unknown' )
					);
					?>
				</p>
				<?php if ( isset( $health['body']['version'] ) ) : ?>
					<p class="description">
						<?php
						printf(
							/* translators: 1: app version, 2: worker driver. */
							esc_html__( 'Version %1$s · background worker: %2$s', 'leadforge-connector' ),
							esc_html( $health['body']['version'] ),
							esc_html( isset( $health['body']['worker']['driver'] ) ? $health['body']['worker']['driver'] : 'unknown' )
						);
						?>
					</p>
				<?php endif; ?>
			<?php else : ?>
				<p>
					<span class="leadforge-dot"></span>
					<?php
					printf(
						/* translators: %s: error message. */
						esc_html__( 'Could not reach the app: %s', 'leadforge-connector' ),
						esc_html( isset( $health['error'] ) ? $health['error'] : 'unknown error' )
					);
					?>
				</p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Shared-secret / signed-request panel.
	 *
	 * @param array|null $status Result of LeadForge_Api::fetch_status().
	 */
	public static function render_status_box( $status ) {
		$settings = self::instance();
		?>
		<div class="leadforge-card <?php echo ( $status && ! empty( $status['ok'] ) ) ? 'is-ok' : 'is-error'; ?>">
			<h3><?php esc_html_e( 'Signed connection', 'leadforge-connector' ); ?></h3>
			<?php if ( ! $settings->is_configured() ) : ?>
				<p><?php esc_html_e( 'Add the workspace URL and shared secret above to test the signed connection.', 'leadforge-connector' ); ?></p>
			<?php elseif ( $status && ! empty( $status['ok'] ) ) : ?>
				<?php $counts = isset( $status['counts'] ) ? $status['counts'] : array(); ?>
				<p>
					<span class="leadforge-dot"></span>
					<?php
					printf(
						/* translators: %s: organisation name. */
						esc_html__( 'Signature accepted. Connected to %s.', 'leadforge-connector' ),
						esc_html( isset( $status['organization']['name'] ) ? $status['organization']['name'] : 'the workspace' )
					);
					?>
				</p>
				<ul class="leadforge-stats">
					<li><strong><?php echo esc_html( isset( $counts['leads'] ) ? $counts['leads'] : 0 ); ?></strong> <?php esc_html_e( 'leads', 'leadforge-connector' ); ?></li>
					<li><strong><?php echo esc_html( isset( $counts['hotLeads'] ) ? $counts['hotLeads'] : 0 ); ?></strong> <?php esc_html_e( 'hot', 'leadforge-connector' ); ?></li>
					<li><strong><?php echo esc_html( isset( $counts['proposalsSent'] ) ? $counts['proposalsSent'] : 0 ); ?></strong> <?php esc_html_e( 'proposals sent', 'leadforge-connector' ); ?></li>
				</ul>
			<?php else : ?>
				<p>
					<span class="leadforge-dot"></span>
					<?php
					printf(
						/* translators: %s: reason the signed request failed. */
						esc_html__( 'The signed request was rejected: %s', 'leadforge-connector' ),
						esc_html( isset( $status['error'] ) ? $status['error'] : 'no response' )
					);
					?>
				</p>
				<p class="description">
					<?php esc_html_e( 'Check that the shared secret here matches WORDPRESS_CONNECTOR_SECRET on the LeadForge server (it must be 24+ characters), and that the server clock is accurate.', 'leadforge-connector' ); ?>
				</p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Shortcode cheat-sheet with the exact examples this install supports.
	 */
	private function render_shortcode_help() {
		?>
		<h2><?php esc_html_e( 'Embedding and linking', 'leadforge-connector' ); ?></h2>
		<div class="leadforge-card">
			<p><?php esc_html_e( 'Signed launch link (users must hold roles the workspace knows about):', 'leadforge-connector' ); ?></p>
			<pre><code>[leadforge_link label="Open LeadForge"]</code></pre>

			<p><?php esc_html_e( 'Embed the workspace on a page:', 'leadforge-connector' ); ?></p>
			<pre><code>[leadforge height="1000" path="/dashboard"]</code></pre>

			<p class="description">
				<?php esc_html_e( 'The embed needs third-party cookies to be allowed for the app domain, otherwise sign-in inside the frame will not stick. For a smoother experience, prefer a subdomain of this site and open it in its own tab.', 'leadforge-connector' ); ?>
			</p>
		</div>
		<?php
	}
}
