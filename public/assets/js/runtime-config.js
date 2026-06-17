/**
 * runtime-config.js — per-deployment overrides.
 *
 * Default (empty) lets the app auto-detect its data source: the PHP backend on
 * IONOS, or static data/ files on a *.github.io host. The GitHub Pages workflow
 * overwrites this file to force { dataMode: 'static' } when it deploys.
 *
 * To force a mode manually (e.g. a custom Pages domain), set:
 *   window.APP_CONFIG = { dataMode: 'static' };   // or 'php'
 */
window.APP_CONFIG = window.APP_CONFIG || {};
