<?php
/**
 * Uninstall routine.
 *
 * Removes the plugin's own options and cached responses. It intentionally does
 * NOT touch anything belonging to the LeadForge application: that lives in a
 * separate system with its own database, and deleting it from a WordPress
 * uninstall would be a destructive surprise.
 *
 * @package LeadForge_Connector
 */

// Only WordPress may run this file, and only during an uninstall.
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'leadforge_connector_settings' );
delete_option( 'leadforge_connector_version' );

// Multisite: clean up every site's copy.
if ( is_multisite() ) {
	$sites = get_sites( array( 'fields' => 'ids' ) );
	foreach ( $sites as $site_id ) {
		switch_to_blog( (int) $site_id );
		delete_option( 'leadforge_connector_settings' );
		delete_option( 'leadforge_connector_version' );
		delete_transient( 'leadforge_health' );
		delete_transient( 'leadforge_status' );
		restore_current_blog();
	}
}

delete_transient( 'leadforge_health' );
delete_transient( 'leadforge_status' );
