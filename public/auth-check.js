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


