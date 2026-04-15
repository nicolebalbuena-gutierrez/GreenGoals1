// Firebase Authentication Helper Functions
// This file provides authentication functions using Firebase Auth

const API_URL = typeof window.getGreenGoalsApiUrl === 'function'
    ? window.getGreenGoalsApiUrl()
    : (window.location.origin || 'http://localhost:3000') + '/api';

// Initialize Firebase Auth only if Firebase is loaded (avoids errors if scripts fail to load)
var auth = null;
if (typeof firebase !== 'undefined' && firebase.auth) {
    auth = firebase.auth();
}

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

/**
 * Register a new user with Firebase Auth
 */
async function registerWithFirebase(email, password, userData) {
    if (!auth) {
        throw new Error('Firebase is not loaded. Check your internet connection and refresh the page.');
    }
    try {
        // Create Firebase Auth user
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const firebaseUser = userCredential.user;
        
        // Send user data to backend to create profile in Firestore
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await firebaseUser.getIdToken()}`
            },
            body: JSON.stringify({
                ...userData,
                firebaseUID: firebaseUser.uid,
                email: email
            })
        });
        
        if (!response.ok) {
            // If backend registration fails, delete the Firebase user
            await firebaseUser.delete();
            const error = await response.json();
            throw new Error(error.error || 'Registration failed');
        }
        
        return {
            user: firebaseUser,
            token: await firebaseUser.getIdToken(),
            userData: await response.json()
        };
    } catch (error) {
        console.error('Registration error:', error);
        throw error;
    }
}

/**
 * Login with Firebase Auth
 */
async function loginWithFirebase(email, password) {
    if (!auth) {
        throw new Error('Firebase is not loaded. Check your internet connection and refresh the page.');
    }
    try {
        // Sign in with Firebase Auth
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const firebaseUser = userCredential.user;
        
        // Get user profile from backend
        const token = await firebaseUser.getIdToken();
        const response = await fetch(`${API_URL}/user/profile`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get user profile');
        }
        
        const userData = await response.json();
        
        return {
            user: firebaseUser,
            token: token,
            userData: userData
        };
    } catch (error) {
        console.error('Login error:', error);
        throw error;
    }
}

/**
 * Logout current user
 */
async function logoutWithFirebase() {
    try {
        if (auth) await auth.signOut();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('firebaseUser');
        return true;
    } catch (error) {
        console.error('Logout error:', error);
        throw error;
    }
}

/**
 * Get current user's ID token
 */
async function getCurrentUserToken() {
    if (!auth) return null;
    const user = auth.currentUser;
    if (user) {
        return await user.getIdToken();
    }
    return null;
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
    return auth && auth.currentUser !== null;
}

/**
 * Get current Firebase user
 */
function getCurrentUser() {
    return auth ? auth.currentUser : null;
}

/**
 * Listen to auth state changes
 */
function onAuthStateChanged(callback) {
    return auth ? auth.onAuthStateChanged(callback) : function() {};
}

// ============================================
// AUTH STATE LISTENER
// ============================================

// Listen for auth state changes (only if auth is available)
if (auth) {
auth.onAuthStateChanged(async (user) => {
    if (user) {
        // User is signed in
        try {
            const token = await user.getIdToken();
            localStorage.setItem('firebaseToken', token);
            
            // Get user profile from backend
            const response = await fetch(`${API_URL}/user/profile`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const userData = await response.json();
                localStorage.setItem('user', JSON.stringify(userData));
            }
        } catch (error) {
            console.error('Error getting user profile:', error);
        }
    } else {
        // User is signed out
        localStorage.removeItem('firebaseToken');
        localStorage.removeItem('user');
    }
});
}
