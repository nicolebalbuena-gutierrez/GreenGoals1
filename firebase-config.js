// Firebase Admin SDK Configuration
// This file initializes Firebase Admin SDK for server-side operations

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// You can use either service account or application default credentials
// Option 1: Using service account JSON file (recommended for production)
// Download your service account key from Firebase Console > Project Settings > Service Accounts
// Place it in the project root as 'firebase-service-account.json'

let firebaseApp;

try {
    // Try to initialize with service account file
    const serviceAccount = require('./firebase-service-account.json');
    firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin initialized with service account');
} catch (error) {
    // Fallback: Use environment variables or application default credentials
    // For local development, you can use: export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        firebaseApp = admin.initializeApp({
            credential: admin.credential.applicationDefault()
        });
        console.log('✅ Firebase Admin initialized with application default credentials');
    } else {
        // For development/testing without credentials, we'll use a mock setup
        // NOTE: This won't work for actual Firebase operations - you MUST set up credentials
        console.warn('⚠️  Firebase Admin not initialized. Please set up Firebase credentials.');
        console.warn('   Option 1: Add firebase-service-account.json file');
        console.warn('   Option 2: Set GOOGLE_APPLICATION_CREDENTIALS environment variable');
        console.warn('   Option 3: Use Firebase emulator for local development');
    }
}

// Get Firestore database instance
const db = firebaseApp ? admin.firestore() : null;

module.exports = {
    admin,
    db,
    firebaseApp
};
