// ============================================
// AUTH CHECK - Include this on protected pages
// ============================================

// Disable browser scroll restoration so each protected page opens at the top
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

(function() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'index.html';
    }
})();

// Logout function
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

// Get current user
function getCurrentUser() {
    const userData = localStorage.getItem('user');
    return userData ? JSON.parse(userData) : null;
}

// Get auth token (for API calls)
function getToken() {
    return localStorage.getItem('token');
}

// Check if current user is admin
function isAdmin() {
    const user = getCurrentUser();
    return user && user.isAdmin === true;
}

// Add admin tab to navigation if user is admin
function addAdminTab() {
    if (!isAdmin()) return;
    
    const tabBar = document.querySelector('.tab-bar');
    if (!tabBar) return;
    
    // Check if admin tab already exists
    if (tabBar.querySelector('a[href="admin-panel.html"]')) return;
    
    // Create admin tab
    const adminTab = document.createElement('a');
    adminTab.href = 'admin-panel.html';
    adminTab.className = 'tab-link';
    if (window.location.pathname.includes('admin-panel')) {
        adminTab.classList.add('active');
    }
    adminTab.innerHTML = 'Admin';
    adminTab.style.background = 'rgba(233, 69, 96, 0.2)';
    adminTab.style.borderColor = 'rgba(233, 69, 96, 0.5)';
    adminTab.style.flex = '1';
    adminTab.style.textAlign = 'center';
    
    tabBar.appendChild(adminTab);
}

function updateChatTabUnreadBadge() {
    const token = localStorage.getItem('token');
    if (!token || typeof window.getGreenGoalsApiUrl !== 'function') return;

    const apiUrl = window.getGreenGoalsApiUrl();
    fetch(`${apiUrl}/chat/unread`, {
        headers: { 'Authorization': 'Bearer ' + token }
    })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
            var total = typeof data.total === 'number' ? data.total : 0;
            document.querySelectorAll('a.tab-link[href="chat.html"]').forEach(function (link) {
                var badge = link.querySelector('.chat-tab-unread-badge');
                if (total <= 0) {
                    if (badge) badge.remove();
                    return;
                }
                var label = total > 99 ? '99+' : String(total);
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'chat-tab-unread-badge';
                    badge.setAttribute('aria-label', total + ' unread chats');
                    link.appendChild(badge);
                }
                badge.textContent = label;
            });
        })
        .catch(function () {});
}

// Auto-add admin tab and chat unread badge when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    addAdminTab();
    updateChatTabUnreadBadge();
});

