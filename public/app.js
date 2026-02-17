// ============================================
// GREENGOALS - Frontend JavaScript
// ============================================

// Use same host as the page, or localhost:3000 if opened as file
const API_URL = (window.location.origin && window.location.origin !== 'file://' && window.location.origin !== 'null')
    ? window.location.origin + '/api'
    : 'http://localhost:3000/api';

// If already logged in, redirect to home or admin
const token = localStorage.getItem('token');
const userData = localStorage.getItem('user');
if (token && userData) {
    try {
        const user = JSON.parse(userData);
        if (user.isAdmin) {
            window.location.href = 'admin-panel.html';
        } else {
            window.location.href = 'home.html';
        }
    } catch (e) {}
}

// DOM Elements
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const tabBtns = document.querySelectorAll('.tab-btn');
const messageDiv = document.getElementById('message');

// ============================================
// TAB SWITCHING
// ============================================

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        // Update active tab button
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Show corresponding form
        if (tab === 'login') {
            loginForm.classList.add('active');
            registerForm.classList.remove('active');
        } else {
            registerForm.classList.add('active');
            loginForm.classList.remove('active');
        }
        
        // Clear message
        hideMessage();
    });
});

// ============================================
// MESSAGE DISPLAY
// ============================================

function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
}

function hideMessage() {
    messageDiv.className = 'message';
    messageDiv.textContent = '';
}

// ============================================
// LOGIN
// ============================================

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const usernameOrEmail = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!password || !usernameOrEmail) {
        showMessage('❌ Please enter username/email and password', 'error');
        return;
    }
    
    showMessage('Signing in...', 'success');
    
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernameOrEmail, password })
        });
        const data = await res.json().catch(() => ({}));
        
        if (res.ok && data.token && data.user) {
            showMessage(`Welcome back, ${data.user.username}!`, 'success');
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            setTimeout(() => {
                window.location.href = data.user.isAdmin ? 'admin-panel.html' : 'home.html';
            }, 500);
        } else {
            showMessage('❌ ' + (data.error || 'Login failed'), 'error');
        }
    } catch (err) {
        showMessage('❌ Cannot reach server. Run: npm start', 'error');
    }
});

// ============================================
// REGISTER
// ============================================

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const firstName = document.getElementById('registerFirstName').value.trim();
    const lastName = document.getElementById('registerLastName').value.trim();
    const username = document.getElementById('registerUsername').value.trim();
    const classYear = document.getElementById('registerClassYear').value;
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    
    if (!email || !password || !username) {
        showMessage('❌ Please fill in email, username, and password', 'error');
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, username, classYear, email, password })
        });
        const data = await res.json().catch(() => ({}));
        
        if (res.ok && data.token && data.user) {
            showMessage(`Welcome to GreenGoals, ${data.user.username}!`, 'success');
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            setTimeout(() => { window.location.href = 'home.html'; }, 500);
        } else {
            showMessage('❌ ' + (data.error || 'Registration failed'), 'error');
        }
    } catch (err) {
        showMessage('❌ Cannot reach server. Run: npm start', 'error');
    }
});

// ============================================
// LOAD STATS
// ============================================

async function loadStats() {
    try {
        const [usersRes, challengesRes] = await Promise.all([
            fetch(`${API_URL}/users`),
            fetch(`${API_URL}/challenges`)
        ]);
        
        const users = await usersRes.json();
        const challenges = await challengesRes.json();
        
        document.getElementById('userCount').textContent = users.length;
        document.getElementById('challengeCount').textContent = challenges.length;
    } catch (error) {
        console.log('Could not load stats - server may not be running');
    }
}

// Load stats on page load
loadStats();
