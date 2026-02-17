// Firebase Service Module
// This module provides database operations using Firebase Firestore
// It replaces the JSON file-based database operations

const { db, admin } = require('./firebase-config');

// Collection names
const COLLECTIONS = {
    USERS: 'users',
    CHALLENGES: 'challenges',
    TEAMS: 'teams',
    UPDATES: 'updates',
    PENDING_EVIDENCE: 'pendingEvidence',
    MESSAGES: 'messages'
};

// Helper function to check if Firebase is initialized
function checkFirebase() {
    if (!db) {
        throw new Error('Firebase not initialized. Please set up Firebase credentials.');
    }
}

// ============================================
// DATABASE OPERATIONS
// ============================================

/**
 * Read all data from Firebase (similar to readDatabase)
 * Returns a promise that resolves to the database structure
 */
async function readDatabase() {
    checkFirebase();
    
    try {
        const [usersSnapshot, challengesSnapshot, teamsSnapshot, updatesSnapshot, evidenceSnapshot] = await Promise.all([
            db.collection(COLLECTIONS.USERS).get(),
            db.collection(COLLECTIONS.CHALLENGES).get(),
            db.collection(COLLECTIONS.TEAMS).get(),
            db.collection(COLLECTIONS.UPDATES).get(),
            db.collection(COLLECTIONS.PENDING_EVIDENCE).get()
        ]);

        const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const challenges = challengesSnapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
        const teams = teamsSnapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
        const updates = updatesSnapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
        const pendingEvidence = evidenceSnapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));

        return {
            users,
            challenges,
            teams,
            updates,
            pendingEvidence
        };
    } catch (error) {
        console.error('Error reading database:', error);
        // Return empty structure on error
        return {
            users: [],
            challenges: [],
            teams: [],
            updates: [],
            pendingEvidence: []
        };
    }
}

/**
 * Write database (for compatibility - Firebase doesn't need this, but we'll keep it for migration)
 * This function is mainly used during migration from JSON to Firebase
 */
async function writeDatabase(data) {
    checkFirebase();
    // This is a no-op for Firebase since we write individual documents
    // But we'll keep it for compatibility during migration
    console.log('Note: writeDatabase is a no-op in Firebase. Use individual collection operations instead.');
}

// ============================================
// USER OPERATIONS
// ============================================

async function getUserById(userId) {
    checkFirebase();
    const doc = await db.collection(COLLECTIONS.USERS).doc(userId.toString()).get();
    if (!doc.exists) return null;
    return { id: parseInt(doc.id), ...doc.data() };
}

async function getUserByUsername(username) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.USERS)
        .where('username', '==', username)
        .limit(1)
        .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: parseInt(doc.id), ...doc.data() };
}

async function getUserByEmail(email) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.USERS)
        .where('email', '==', email)
        .limit(1)
        .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: parseInt(doc.id), ...doc.data() };
}

async function getUserByFirebaseUID(firebaseUID) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.USERS)
        .where('firebaseUID', '==', firebaseUID)
        .limit(1)
        .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: parseInt(doc.id), ...doc.data() };
}

async function createUser(userData) {
    checkFirebase();
    // Get next ID by counting existing users
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    const nextId = usersSnapshot.size + 1;
    
    const userRef = db.collection(COLLECTIONS.USERS).doc(nextId.toString());
    await userRef.set({
        ...userData,
        id: nextId
    });
    
    return { id: nextId, ...userData };
}

async function updateUser(userId, updates) {
    checkFirebase();
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId.toString());
    await userRef.update(updates);
    return await getUserById(userId);
}

async function getAllUsers() {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function deleteUser(userId) {
    checkFirebase();
    await db.collection(COLLECTIONS.USERS).doc(userId.toString()).delete();
}

// ============================================
// CHALLENGE OPERATIONS
// ============================================

async function getAllChallenges() {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.CHALLENGES).get();
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function getChallengeById(challengeId) {
    checkFirebase();
    const doc = await db.collection(COLLECTIONS.CHALLENGES).doc(challengeId.toString()).get();
    if (!doc.exists) return null;
    return { id: parseInt(doc.id), ...doc.data() };
}

async function createChallenge(challengeData) {
    checkFirebase();
    const challengesSnapshot = await db.collection(COLLECTIONS.CHALLENGES).get();
    const nextId = challengesSnapshot.size > 0 
        ? Math.max(...challengesSnapshot.docs.map(d => parseInt(d.id))) + 1 
        : 1;
    
    const challengeRef = db.collection(COLLECTIONS.CHALLENGES).doc(nextId.toString());
    await challengeRef.set({
        ...challengeData,
        id: nextId
    });
    
    return { id: nextId, ...challengeData };
}

async function updateChallenge(challengeId, updates) {
    checkFirebase();
    const challengeRef = db.collection(COLLECTIONS.CHALLENGES).doc(challengeId.toString());
    await challengeRef.update(updates);
    return await getChallengeById(challengeId);
}

async function deleteChallenge(challengeId) {
    checkFirebase();
    await db.collection(COLLECTIONS.CHALLENGES).doc(challengeId.toString()).delete();
}

// ============================================
// TEAM OPERATIONS
// ============================================

async function getAllTeams() {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.TEAMS).get();
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function getTeamById(teamId) {
    checkFirebase();
    const doc = await db.collection(COLLECTIONS.TEAMS).doc(teamId.toString()).get();
    if (!doc.exists) return null;
    return { id: parseInt(doc.id), ...doc.data() };
}

async function createTeam(teamData) {
    checkFirebase();
    const teamsSnapshot = await db.collection(COLLECTIONS.TEAMS).get();
    const nextId = teamsSnapshot.size > 0 
        ? Math.max(...teamsSnapshot.docs.map(d => parseInt(d.id))) + 1 
        : 1;
    
    const teamRef = db.collection(COLLECTIONS.TEAMS).doc(nextId.toString());
    await teamRef.set({
        ...teamData,
        id: nextId
    });
    
    return { id: nextId, ...teamData };
}

async function updateTeam(teamId, updates) {
    checkFirebase();
    const teamRef = db.collection(COLLECTIONS.TEAMS).doc(teamId.toString());
    await teamRef.update(updates);
    return await getTeamById(teamId);
}

async function deleteTeam(teamId) {
    checkFirebase();
    await db.collection(COLLECTIONS.TEAMS).doc(teamId.toString()).delete();
}

// ============================================
// UPDATE OPERATIONS
// ============================================

async function getAllUpdates() {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.UPDATES)
        .orderBy('createdAt', 'desc')
        .get();
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function createUpdate(updateData) {
    checkFirebase();
    const updatesSnapshot = await db.collection(COLLECTIONS.UPDATES).get();
    const nextId = updatesSnapshot.size > 0 
        ? Math.max(...updatesSnapshot.docs.map(d => parseInt(d.id))) + 1 
        : 1;
    
    const updateRef = db.collection(COLLECTIONS.UPDATES).doc(nextId.toString());
    await updateRef.set({
        ...updateData,
        id: nextId
    });
    
    return { id: nextId, ...updateData };
}

async function updateUpdate(updateId, updates) {
    checkFirebase();
    const updateRef = db.collection(COLLECTIONS.UPDATES).doc(updateId.toString());
    await updateRef.update(updates);
    const doc = await updateRef.get();
    return { id: parseInt(doc.id), ...doc.data() };
}

async function deleteUpdate(updateId) {
    checkFirebase();
    await db.collection(COLLECTIONS.UPDATES).doc(updateId.toString()).delete();
}

// ============================================
// EVIDENCE OPERATIONS
// ============================================

async function getAllPendingEvidence() {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.PENDING_EVIDENCE)
        .where('status', '==', 'pending')
        .get();
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function getAllEvidence() {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.PENDING_EVIDENCE).get();
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function getEvidenceByUserId(userId) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.PENDING_EVIDENCE)
        .where('userId', '==', userId)
        .get();
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function getEvidenceById(evidenceId) {
    checkFirebase();
    const doc = await db.collection(COLLECTIONS.PENDING_EVIDENCE).doc(evidenceId.toString()).get();
    if (!doc.exists) return null;
    return { id: parseInt(doc.id), ...doc.data() };
}

async function createEvidence(evidenceData) {
    checkFirebase();
    const evidenceSnapshot = await db.collection(COLLECTIONS.PENDING_EVIDENCE).get();
    const nextId = evidenceSnapshot.size > 0 
        ? Math.max(...evidenceSnapshot.docs.map(d => parseInt(d.id))) + 1 
        : 1;
    
    const evidenceRef = db.collection(COLLECTIONS.PENDING_EVIDENCE).doc(nextId.toString());
    await evidenceRef.set({
        ...evidenceData,
        id: nextId
    });
    
    return { id: nextId, ...evidenceData };
}

async function updateEvidence(evidenceId, updates) {
    checkFirebase();
    const evidenceRef = db.collection(COLLECTIONS.PENDING_EVIDENCE).doc(evidenceId.toString());
    await evidenceRef.update(updates);
    return await getEvidenceById(evidenceId);
}

// ============================================
// MESSAGE OPERATIONS (Chat)
// ============================================

/** Get conversation ID for DM between two users (deterministic, sorted) */
function getDmConversationId(userId1, userId2) {
    const a = parseInt(userId1);
    const b = parseInt(userId2);
    return `dm_${Math.min(a, b)}_${Math.max(a, b)}`;
}

async function getMessagesByConversation(conversationId, limit = 100) {
    checkFirebase();
    // Query without orderBy to avoid needing a Firestore composite index
    const snapshot = await db.collection(COLLECTIONS.MESSAGES)
        .where('conversationId', '==', conversationId)
        .limit(limit)
        .get();
    
    const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null
        };
    });
    // Sort by createdAt in memory (oldest first)
    messages.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
    });
    return messages;
}

async function createMessage(conversationId, senderId, senderUsername, text, recipientId = null, imageBase64 = null, imageMimeType = 'image/jpeg') {
    checkFirebase();
    const senderIdNum = parseInt(senderId);
    const messageData = {
        conversationId,
        senderId: senderIdNum,
        senderUsername: senderUsername || '',
        text: String(text || '').trim().substring(0, 2000),
        createdAt: admin && admin.firestore ? admin.firestore.FieldValue.serverTimestamp() : new Date()
    };
    if (recipientId) messageData.recipientId = parseInt(recipientId);
    // Store image (max ~700KB base64 to stay under Firestore 1MB doc limit)
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length < 950000) {
        messageData.imageBase64 = imageBase64;
        messageData.imageMimeType = (imageMimeType === 'image/png' ? 'image/png' : 'image/jpeg');
    }
    
    const docRef = await db.collection(COLLECTIONS.MESSAGES).add(messageData);
    const doc = await docRef.get();
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : new Date().toISOString()
    };
}

async function getAllMessages(limit = 500) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.MESSAGES)
        .limit(limit)
        .get();
    
    const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null
        };
    });
    messages.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta; // newest first for admin view
    });
    return messages;
}

async function getMessageById(messageId) {
    checkFirebase();
    const doc = await db.collection(COLLECTIONS.MESSAGES).doc(messageId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null
    };
}

async function deleteMessage(messageId) {
    checkFirebase();
    await db.collection(COLLECTIONS.MESSAGES).doc(messageId).delete();
}

/** Get list of user IDs that the current user has DM conversations with (for conversation list) */
async function getDmConversationPartnerIds(userId) {
    checkFirebase();
    const uid = parseInt(userId);
    const partnerIds = new Set();
    
    // Messages where user is sender (DMs have recipientId)
    const sentSnapshot = await db.collection(COLLECTIONS.MESSAGES)
        .where('senderId', '==', uid)
        .get();
    sentSnapshot.docs.forEach(doc => {
        const d = doc.data();
        if (d.recipientId && d.conversationId && d.conversationId.startsWith('dm_')) partnerIds.add(d.recipientId);
    });
    
    // Messages where user is recipient
    const receivedSnapshot = await db.collection(COLLECTIONS.MESSAGES)
        .where('recipientId', '==', uid)
        .get();
    receivedSnapshot.docs.forEach(doc => {
        const d = doc.data();
        if (d.senderId) partnerIds.add(d.senderId);
    });
    
    return Array.from(partnerIds);
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize database with sample challenges if empty
 */
async function initializeDatabase() {
    checkFirebase();
    
    const challengesSnapshot = await db.collection(COLLECTIONS.CHALLENGES).get();
    
    if (challengesSnapshot.empty) {
        const sampleChallenges = [
            { name: 'No plastic for 3 days', description: 'Avoid single-use plastics for 3 consecutive days', points: 50, category: 'Reduce', difficulty: 'Medium', duration: '3 days', co2Saved: 2.5 },
            { name: 'Plant a tree', description: 'Plant a tree in your community or backyard', points: 100, category: 'Nature', difficulty: 'Hard', duration: '1 day', co2Saved: 22 },
            { name: 'Bike to work', description: 'Use a bicycle instead of car for commuting', points: 35, category: 'Transport', difficulty: 'Easy', duration: '1 day', co2Saved: 1.8 },
            { name: 'Meatless Monday', description: 'Go vegetarian for an entire Monday', points: 25, category: 'Food', difficulty: 'Easy', duration: '1 day', co2Saved: 3.6 },
            { name: 'Zero waste week', description: 'Produce zero landfill waste for one week', points: 150, category: 'Reduce', difficulty: 'Hard', duration: '7 days', co2Saved: 8.2 },
            { name: 'Cold shower challenge', description: 'Take cold showers for 5 days to save energy', points: 40, category: 'Energy', difficulty: 'Medium', duration: '5 days', co2Saved: 2.1 }
        ];
        
        const batch = db.batch();
        sampleChallenges.forEach((challenge, index) => {
            const challengeRef = db.collection(COLLECTIONS.CHALLENGES).doc((index + 1).toString());
            batch.set(challengeRef, { ...challenge, id: index + 1 });
        });
        
        await batch.commit();
        console.log('✅ Initialized database with sample challenges');
    }
}

module.exports = {
    // Database operations
    readDatabase,
    writeDatabase,
    initializeDatabase,
    
    // User operations
    getUserById,
    getUserByUsername,
    getUserByEmail,
    getUserByFirebaseUID,
    createUser,
    updateUser,
    getAllUsers,
    deleteUser,
    
    // Challenge operations
    getAllChallenges,
    getChallengeById,
    createChallenge,
    updateChallenge,
    deleteChallenge,
    
    // Team operations
    getAllTeams,
    getTeamById,
    createTeam,
    updateTeam,
    deleteTeam,
    
    // Update operations
    getAllUpdates,
    createUpdate,
    updateUpdate,
    deleteUpdate,
    
    // Evidence operations
    getAllPendingEvidence,
    getAllEvidence,
    getEvidenceByUserId,
    getEvidenceById,
    createEvidence,
    updateEvidence,
    
    // Message operations
    getDmConversationId,
    getMessagesByConversation,
    createMessage,
    getDmConversationPartnerIds,
    getAllMessages,
    getMessageById,
    deleteMessage
};
