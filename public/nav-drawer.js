/**
 * Moves the main .tab-bar into a left slide-out drawer and adds a menu toggle.
 * Runs on dashboard pages that include a .container.dashboard-container .tab-bar.
 */
(function () {
    function init() {
        var header = document.querySelector('.dashboard-header');
        var container = document.querySelector('.container.dashboard-container');
        var tabBar = container ? container.querySelector('.tab-bar') : null;

        if (!header || !tabBar || document.getElementById('ggNavDrawerRoot')) {
            return;
        }

        var root = document.createElement('div');
        root.id = 'ggNavDrawerRoot';
        root.className = 'gg-nav-drawer-root';
        root.setAttribute('aria-hidden', 'true');

        var backdrop = document.createElement('div');
        backdrop.className = 'gg-nav-drawer-backdrop';

        var panel = document.createElement('aside');
        panel.className = 'gg-nav-drawer-panel';
        panel.id = 'ggNavDrawerPanel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'ggNavDrawerTitle');

        var drawerHead = document.createElement('div');
        drawerHead.className = 'gg-nav-drawer-header';

        var title = document.createElement('span');
        title.id = 'ggNavDrawerTitle';
        title.className = 'gg-nav-drawer-title';
        title.textContent = 'GreenGoals';

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gg-nav-drawer-close';
        closeBtn.setAttribute('aria-label', 'Close menu');
        closeBtn.innerHTML = '&times;';

        drawerHead.appendChild(title);
        drawerHead.appendChild(closeBtn);

        var nav = document.createElement('nav');
        nav.className = 'gg-nav-drawer-nav';

        nav.appendChild(tabBar);
        panel.appendChild(drawerHead);
        panel.appendChild(nav);
        root.appendChild(backdrop);
        root.appendChild(panel);
        document.body.appendChild(root);

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'gg-nav-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'ggNavDrawerPanel');
        toggle.setAttribute('aria-label', 'Open menu');
        toggle.innerHTML = '<span class="gg-nav-toggle-bars" aria-hidden="true"></span>';

        header.insertBefore(toggle, header.firstChild);

        function setOpen(open) {
            root.classList.toggle('is-open', open);
            root.setAttribute('aria-hidden', open ? 'false' : 'true');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            document.body.classList.toggle('gg-nav-drawer-open', open);
            if (open) {
                var first = tabBar.querySelector('a.tab-link');
                if (first) {
                    window.setTimeout(function () {
                        first.focus();
                    }, 0);
                } else {
                    closeBtn.focus();
                }
            } else {
                toggle.focus();
            }
        }

        toggle.addEventListener('click', function () {
            setOpen(!root.classList.contains('is-open'));
        });
        closeBtn.addEventListener('click', function () {
            setOpen(false);
        });
        backdrop.addEventListener('click', function () {
            setOpen(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && root.classList.contains('is-open')) {
                setOpen(false);
            }
        });
        tabBar.addEventListener('click', function (e) {
            if (e.target.closest('a.tab-link')) {
                setOpen(false);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
