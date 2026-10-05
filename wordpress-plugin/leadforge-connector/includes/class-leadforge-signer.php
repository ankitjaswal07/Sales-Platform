<?php
/**
 * Shared-secret signing.
 *
 * Mirrors `src/lib/api/connector.ts` in the LeadForge application exactly:
 *
 *   signature = base64url( HMAC-SHA256( secret, "{action}|{email}|{ts}|{nonce}" ) )
 *
 * Keeping this in one small class means the plugin has a single place where
 * cryptography happens, and it is easy to audit against the server side.
 *
 * @package LeadForge_Connector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Produces and verifies signed launch payloads.
 */
class LeadForge_Signer {

	/**
	 * Sign a user launch payload.
	 *
	 * @param string $secret Shared secret (LeadForge's WORDPRESS_CONNECTOR_SECRET).
	 * @param string $email  WordPress user's email address.
	 * @param int    $ts     Unix timestamp in seconds.
	 * @param string $nonce  Single-use random string.
	 * @return string base64url signature.
	 */
	public static function sign_launch( $secret, $email, $ts, $nonce ) {
		$message = 'sso|' . strtolower( $email ) . '|' . (int) $ts . '|' . $nonce;
		return self::base64url_encode( hash_hmac( 'sha256', $message, $secret, true ) );
	}

	/**
	 * Sign a server-to-server status request (no user involved).
	 *
	 * @param string $secret Shared secret.
	 * @param int    $ts     Unix timestamp in seconds.
	 * @param string $nonce  Single-use random string.
	 * @return string base64url signature.
	 */
	public static function sign_status( $secret, $ts, $nonce ) {
		$message = 'status|' . (int) $ts . '|' . $nonce;
		return self::base64url_encode( hash_hmac( 'sha256', $message, $secret, true ) );
	}

	/**
	 * A random, URL-safe nonce.
	 *
	 * @return string
	 */
	public static function nonce() {
		if ( function_exists( 'random_bytes' ) ) {
			try {
				return self::base64url_encode( random_bytes( 16 ) );
			} catch ( Exception $e ) {
				// Fall through to the WordPress generator below.
				unset( $e );
			}
		}
		return substr( wp_generate_password( 32, false, false ), 0, 22 );
	}

	/**
	 * base64url without padding, matching Node's 'base64url' encoding.
	 *
	 * @param string $binary Raw bytes.
	 * @return string
	 */
	private static function base64url_encode( $binary ) {
		return rtrim( strtr( base64_encode( $binary ), '+/', '-_' ), '=' );
	}
}
