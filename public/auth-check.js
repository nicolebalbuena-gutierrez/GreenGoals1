// ============================================
// AUTH CHECK - Include this on protected pages
// ============================================

(function() {
    const token = localStorage.getItem('token');
    if (!token) {
        // Not logged in - redirect to login page
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

// Get auth token
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

// Auto-add admin tab when DOM is ready
document.addEventListener('DOMContentLoaded', addAdminTab);

