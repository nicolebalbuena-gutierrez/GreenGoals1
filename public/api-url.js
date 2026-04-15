/**
 * Resolves the API base URL for web, local dev, and Capacitor iOS/Android.
 *
 * Recommended for App Store builds: set capacitor.config server.url to your HTTPS site
 * (same host as this API). Then location.origin works and you need nothing else.
 *
 * If you ship bundled HTML with a capacitor:// origin, set before this script loads:
 *   window.GREENGOALS_SERVER_ORIGIN = 'https://your-deployed-site.com';
 * (no trailing slash; do not include /api)
 */
(function () {
    'use strict';

    function getGreenGoalsApiUrl() {
        var custom = typeof window !== 'undefined' && window.GREENGOALS_SERVER_ORIGIN;
        if (custom && String(custom).trim()) {
            return String(custom).replace(/\/$/, '') + '/api';
        }
        var o = typeof window !== 'undefined' && window.location && window.location.origin;
        if (!o || o === 'file://' || o === 'null') {
            return 'http://localhost:3000/api';
        }
        if (/^(capacitor|ionic):/i.test(o)) {
            return 'http://localhost:3000/api';
        }
        return o + '/api';
    }

    window.getGreenGoalsApiUrl = getGreenGoalsApiUrl;
})();
