<?php
/**
 * Talks to the LeadForge application over HTTP.
 *
 * Two calls only: an unsigned health check (public by design) and a signed
 * status request (HMAC, short-lived, single purpose). Everything is cached
 * briefly so admin screens and the dashboard widget do not hammer the app.
 *
 * @package LeadForge_Connector
 */

defined( 'ABSPATH' ) || exit;

/**
 * HTTP client for the workspace.
 */
class LeadForge_Api {

	const CACHE_TTL = 60;

	/**
	 * Singleton instance.
	 *
	 * @var LeadForge_Api|null
	 */
	private static $instance = null;

	/**
	 * Get the singleton.
	 *
	 * @return LeadForge_Api
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * The configured workspace URL.
	 *
	 * @return string
	 */
	private function base_url() {
		return LeadForge_Settings::instance()->base_url();
	}

	/**
	 * The shared secret.
	 *
	 * @return string
	 */
	private function secret() {
		return LeadForge_Settings::instance()->secret();
	}

	/**
	 * Public health endpoint. No credentials involved.
	 *
	 * @return array|null Null when nothing is configured yet.
	 */
	public function fetch_health() {
		if ( ! $this->base_url() ) {
			return null;
		}

		$cached = get_transient( 'leadforge_health' );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$response = wp_remote_get(
			$this->base_url() . '/api/health',
			array(
				'timeout'   => 8,
				'sslverify' => true,
				'headers'   => array( 'accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) ) {
			$result = array(
				'reachable' => false,
				'error'     => $response->get_error_message(),
			);
			// Cache failures briefly so a broken URL does not stall every page load.
			set_transient( 'leadforge_health', $result, 30 );
			return $result;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		$result = array(
			'reachable' => true,
			'code'      => (int) wp_remote_retrieve_response_code( $response ),
			'body'      => is_array( $body ) ? $body : array(),
		);
		set_transient( 'leadforge_health', $result, self::CACHE_TTL );
		return $result;
	}

	/**
	 * Signed status request.
	 *
	 * @return array|null Null when the plugin is not configured.
	 */
	public function fetch_status() {
		if ( ! $this->base_url() || ! $this->secret() ) {
			return null;
		}

		$cached = get_transient( 'leadforge_status' );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$ts    = time();
		$nonce = LeadForge_Signer::nonce();
		$sig   = LeadForge_Signer::sign_status( $this->secret(), $ts, $nonce );

		$url = add_query_arg(
			array(
				'ts'    => $ts,
				'nonce' => $nonce,
				'sig'   => $sig,
			),
			$this->base_url() . '/api/integrations/wordpress/status'
		);

		$response = wp_remote_get(
			$url,
			array(
				'timeout'   => 8,
				'sslverify' => true,
				'headers'   => array( 'accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) ) {
			$result = array(
				'ok'    => false,
				'error' => $response->get_error_message(),
			);
			set_transient( 'leadforge_status', $result, 30 );
			return $result;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code || ! is_array( $body ) ) {
			$message = is_array( $body ) && isset( $body['error'] ) ? $body['error'] : sprintf( 'HTTP %d', $code );
			$result  = array(
				'ok'    => false,
				'error' => $message,
			);
			set_transient( 'leadforge_status', $result, 30 );
			return $result;
		}

		$body['ok'] = true;
		set_transient( 'leadforge_status', $body, self::CACHE_TTL );
		return $body;
	}

	/**
	 * Clear cached responses (called when settings are saved).
	 */
	public function flush_cache() {
		delete_transient( 'leadforge_health' );
		delete_transient( 'leadforge_status' );
	}
}
