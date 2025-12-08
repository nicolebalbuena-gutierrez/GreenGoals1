// ============================================
// GREENGOALS - Frontend JavaScript
// ============================================

const API_URL = 'http://localhost:3000/api';

// Check if already logged in - redirect appropriately
const token = localStorage.getItem('token');
if (token) {
    const userData = localStorage.getItem('user');
    if (userData) {
        const user = JSON.parse(userData);
        // Redirect admins to admin panel, others to home
        if (user.isAdmin) {
            window.location.href = 'admin-panel.html';
        } else {
            window.location.href = 'home.html';
        }
    } else {
        window.location.href = 'home.html';
    }
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
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(`Welcome back, ${data.user.username}!`, 'success');
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            // Redirect admins to admin panel, others to home
            setTimeout(() => {
                if (data.user.isAdmin) {
                    window.location.href = 'admin-panel.html';
                } else {
                    window.location.href = 'home.html';
                }
            }, 800);
        } else {
            showMessage(`❌ ${data.error}`, 'error');
        }
    } catch (error) {
        showMessage('❌ Could not connect to server. Make sure it\'s running!', 'error');
    }
});

// ============================================
// REGISTER
// ============================================

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const firstName = document.getElementById('registerFirstName').value;
    const lastName = document.getElementById('registerLastName').value;
    const username = document.getElementById('registerUsername').value;
    const classYear = document.getElementById('registerClassYear').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, username, classYear, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(`Welcome to GreenGoals, ${data.user.username}!`, 'success');
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            // Redirect to home (new users aren't admins)
            setTimeout(() => {
                window.location.href = 'home.html';
            }, 800);
        } else {
            showMessage(`❌ ${data.error}`, 'error');
        }
    } catch (error) {
        showMessage('❌ Could not connect to server. Make sure it\'s running!', 'error');
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
