/**
 * Full-page loading overlay for GreenGoals (shared across HTML pages).
 * Depends on styles in styles.css (.gg-page-loader).
 */
(function () {
    var LOADER_ID = 'ggPageLoader';

    function ensureLoader() {
        var el = document.getElementById(LOADER_ID);
        if (el) return el;
        el = document.createElement('div');
        el.id = LOADER_ID;
        el.className = 'gg-page-loader';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-busy', 'true');
        el.innerHTML =
            '<div class="gg-page-loader-card">' +
            '<div class="gg-page-loader-spinner" aria-hidden="true"></div>' +
            '<p class="gg-page-loader-msg">Loading…</p>' +
            '</div>';
        if (document.body) {
            document.body.insertBefore(el, document.body.firstChild);
        }
        return el;
    }

    window.showGreenGoalsPageLoader = function (message) {
        var el = ensureLoader();
        var msgEl = el.querySelector('.gg-page-loader-msg');
        if (msgEl && message) {
            msgEl.textContent = message;
        }
        el.classList.remove('gg-page-loader--done');
        el.setAttribute('aria-busy', 'true');
    };

    window.hideGreenGoalsPageLoader = function () {
        var el = document.getElementById(LOADER_ID);
        if (!el) return;
        el.classList.add('gg-page-loader--done');
        el.setAttribute('aria-busy', 'false');
    };
})();
