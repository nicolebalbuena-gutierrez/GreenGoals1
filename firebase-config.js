// Firebase Admin SDK Configuration
// This file initializes Firebase Admin SDK for server-side operations

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// You can use either service account or application default credentials
// Option 1 (best for Replit): FIREBASE_SERVICE_ACCOUNT_JSON env var (paste full JSON)
// Option 2: FIREBASE_SERVICE_ACCOUNT_BASE64 env var (base64 of the JSON)
// Option 3 (local dev): ignored service account JSON file in repo root
// Option 4: GOOGLE_APPLICATION_CREDENTIALS for application default credentials

let firebaseApp;

try {
    // Prefer env var JSON (works well in hosted environments like Replit)
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        console.log('✅ Firebase Admin: loaded service account from FIREBASE_SERVICE_ACCOUNT_JSON');
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString(
            'utf8'
        );
        serviceAccount = JSON.parse(raw);
        console.log('✅ Firebase Admin: loaded service account from FIREBASE_SERVICE_ACCOUNT_BASE64');
    } else {
        // Local fallback: ignored file in repo root
        // eslint-disable-next-line import/no-dynamic-require, global-require
        serviceAccount = require('./firebase-service-account.json');
        console.log('✅ Firebase Admin: loaded service account from firebase-service-account.json');
    }

    firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
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
        console.warn('   Option 1: Set FIREBASE_SERVICE_ACCOUNT_JSON (recommended on Replit)');
        console.warn('   Option 2: Set FIREBASE_SERVICE_ACCOUNT_BASE64');
        console.warn('   Option 3: Set GOOGLE_APPLICATION_CREDENTIALS');
        console.warn('   Option 4: Use Firebase emulator for local development');
    }
}

// Get Firestore database instance
const db = firebaseApp ? admin.firestore() : null;

module.exports = {
    admin,
    db,
    firebaseApp
};
