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
    MESSAGES: 'messages',
    TEAM_JOIN_REQUESTS: 'teamJoinRequests',
    TEAM_MEMBER_INVITES: 'teamMemberInvites',
    FOLLOWS: 'follows'
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
    if (userId == null || userId === '') return null;
    const idNum = typeof userId === 'number' ? userId : parseInt(userId, 10);
    if (Number.isNaN(idNum)) return null;
    const doc = await db.collection(COLLECTIONS.USERS).doc(String(idNum)).get();
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

/** Find users who have challengeId in their activeChallenges (handles type mismatch) */
async function getUsersWithChallengeInActive(challengeId) {
    checkFirebase();
    const numId = parseInt(challengeId, 10);
    if (Number.isNaN(numId)) return [];
    const snapshot = await db.collection(COLLECTIONS.USERS)
        .where('activeChallenges', 'array-contains', numId)
        .get();
    if (snapshot.empty) {
        const snapshotStr = await db.collection(COLLECTIONS.USERS)
            .where('activeChallenges', 'array-contains', String(numId))
            .get();
        return snapshotStr.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
    }
    return snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
}

async function deleteUser(userId) {
    checkFirebase();
    await db.collection(COLLECTIONS.USERS).doc(userId.toString()).delete();
}

// ============================================
// FOLLOW OPERATIONS
// ============================================

async function followUser(followerId, followingId) {
    checkFirebase();
    if (followerId === followingId) return { alreadyFollowing: false, created: false };
    const id = `${followerId}_${followingId}`;
    const ref = db.collection(COLLECTIONS.FOLLOWS).doc(id);
    const doc = await ref.get();
    if (doc.exists) return { alreadyFollowing: true, created: false };
    await ref.set({ followerId: parseInt(followerId), followingId: parseInt(followingId), createdAt: new Date().toISOString() });
    return { alreadyFollowing: false, created: true };
}

async function unfollowUser(followerId, followingId) {
    checkFirebase();
    const id = `${followerId}_${followingId}`;
    await db.collection(COLLECTIONS.FOLLOWS).doc(id).delete();
    return true;
}

async function isFollowing(followerId, followingId) {
    checkFirebase();
    const id = `${followerId}_${followingId}`;
    const doc = await db.collection(COLLECTIONS.FOLLOWS).doc(id).get();
    return doc.exists;
}

async function getFollowersCount(userId) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.FOLLOWS)
        .where('followingId', '==', parseInt(userId))
        .get();
    return snapshot.size;
}

async function getFollowingCount(userId) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.FOLLOWS)
        .where('followerId', '==', parseInt(userId))
        .get();
    return snapshot.size;
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
    const ids = challengesSnapshot.docs.map(d => parseInt(d.id, 10)).filter(id => !Number.isNaN(id));
    const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    
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
// TEAM JOIN REQUEST OPERATIONS
// ============================================

async function createTeamJoinRequest(data) {
    checkFirebase();
    const col = db.collection(COLLECTIONS.TEAM_JOIN_REQUESTS);
    const snapshot = await col.get();
    const nextId = snapshot.size > 0
        ? Math.max(...snapshot.docs.map(d => parseInt(d.id))) + 1
        : 1;
    const ref = col.doc(nextId.toString());
    await ref.set({
        ...data,
        id: nextId,
        status: data.status || 'pending',
        createdAt: data.createdAt || new Date().toISOString()
    });
    return { id: nextId, ...data, status: data.status || 'pending', createdAt: data.createdAt || new Date().toISOString() };
}

async function getTeamJoinRequestsByTeamId(teamId) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.TEAM_JOIN_REQUESTS)
        .where('teamId', '==', parseInt(teamId))
        .get();
    return snapshot.docs
        .map(doc => ({ id: parseInt(doc.id), ...doc.data() }))
        .filter(r => r.status === 'pending');
}

async function getTeamJoinRequestByUserAndTeam(userId, teamId) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.TEAM_JOIN_REQUESTS)
        .where('userId', '==', parseInt(userId))
        .get();
    return snapshot.docs
        .map(doc => ({ id: parseInt(doc.id), ...doc.data() }))
        .find(r => r.teamId === parseInt(teamId) && r.status === 'pending') || null;
}

async function getTeamJoinRequestById(requestId) {
    checkFirebase();
    const doc = await db.collection(COLLECTIONS.TEAM_JOIN_REQUESTS).doc(requestId.toString()).get();
    if (!doc.exists) return null;
    return { id: parseInt(doc.id), ...doc.data() };
}

async function updateTeamJoinRequest(requestId, updates) {
    checkFirebase();
    const ref = db.collection(COLLECTIONS.TEAM_JOIN_REQUESTS).doc(requestId.toString());
    await ref.update(updates);
    return await getTeamJoinRequestById(requestId);
}

async function getUserPendingTeamJoinRequestTeamIds(userId) {
    checkFirebase();
    const snapshot = await db.collection(COLLECTIONS.TEAM_JOIN_REQUESTS)
        .where('userId', '==', parseInt(userId))
        .get();
    return snapshot.docs
        .map(doc => doc.data())
        .filter(r => r.status === 'pending')
        .map(r => r.teamId);
}

// ============================================
// TEAM MEMBER INVITES (member invites user; user accepts/declines)
// ============================================

async function createTeamMemberInvite(data) {
    checkFirebase();
    const col = db.collection(COLLECTIONS.TEAM_MEMBER_INVITES);
    const snapshot = await col.get();
    const nextId = snapshot.size > 0
        ? Math.max(...snapshot.docs.map(d => parseInt(d.id, 10))) + 1
        : 1;
    const ref = col.doc(nextId.toString());
    const row = {
        ...data,
        id: nextId,
        teamId: parseInt(data.teamId, 10),
        inviterUserId: parseInt(data.inviterUserId, 10),
        inviteeUserId: parseInt(data.inviteeUserId, 10),
        status: data.status || 'pending',
        createdAt: data.createdAt || new Date().toISOString()
    };
    await ref.set(row);
    return row;
}

async function getTeamMemberInviteById(inviteId) {
    checkFirebase();
    const doc = await db.collection(COLLECTIONS.TEAM_MEMBER_INVITES).doc(String(inviteId)).get();
    if (!doc.exists) return null;
    return { id: parseInt(doc.id, 10), ...doc.data() };
}

async function getPendingTeamMemberInviteByTeamAndInvitee(teamId, inviteeUserId) {
    checkFirebase();
    const tid = parseInt(teamId, 10);
    const uid = parseInt(inviteeUserId, 10);
    const snapshot = await db.collection(COLLECTIONS.TEAM_MEMBER_INVITES)
        .where('teamId', '==', tid)
        .get();
    return snapshot.docs
        .map(d => ({ id: parseInt(d.id, 10), ...d.data() }))
        .find(inv => inv.inviteeUserId === uid && inv.status === 'pending') || null;
}

async function getPendingTeamMemberInvitesForInvitee(inviteeUserId) {
    checkFirebase();
    const uid = parseInt(inviteeUserId, 10);
    const snapshot = await db.collection(COLLECTIONS.TEAM_MEMBER_INVITES)
        .where('inviteeUserId', '==', uid)
        .get();
    return snapshot.docs
        .map(d => ({ id: parseInt(d.id, 10), ...d.data() }))
        .filter(inv => inv.status === 'pending');
}

async function getPendingTeamMemberInvitesForTeam(teamId) {
    checkFirebase();
    const tid = parseInt(teamId, 10);
    const snapshot = await db.collection(COLLECTIONS.TEAM_MEMBER_INVITES)
        .where('teamId', '==', tid)
        .get();
    return snapshot.docs
        .map(d => ({ id: parseInt(d.id, 10), ...d.data() }))
        .filter(inv => inv.status === 'pending');
}

async function updateTeamMemberInvite(inviteId, updates) {
    checkFirebase();
    const ref = db.collection(COLLECTIONS.TEAM_MEMBER_INVITES).doc(String(inviteId));
    await ref.update(updates);
    return await getTeamMemberInviteById(inviteId);
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

async function deleteEvidence(evidenceId) {
    checkFirebase();
    await db.collection(COLLECTIONS.PENDING_EVIDENCE).doc(evidenceId.toString()).delete();
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
            likedBy: Array.isArray(data.likedBy) ? data.likedBy.map(id => parseInt(id)) : [],
            parentMessageId: data.parentMessageId || null,
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

async function createMessage(conversationId, senderId, senderUsername, text, recipientId = null, imageBase64 = null, imageMimeType = 'image/jpeg', parentMessageId = null) {
    checkFirebase();
    const senderIdNum = parseInt(senderId);
    const messageData = {
        conversationId,
        senderId: senderIdNum,
        senderUsername: senderUsername || '',
        text: String(text || '').trim().substring(0, 2000),
        createdAt: admin && admin.firestore ? admin.firestore.FieldValue.serverTimestamp() : new Date(),
        likedBy: [],
        parentMessageId: parentMessageId || null
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

async function updateMessage(messageId, updates) {
    checkFirebase();
    const ref = db.collection(COLLECTIONS.MESSAGES).doc(messageId);
    await ref.update(updates);
    return await getMessageById(messageId);
}

/**
 * Given dm_<low>_<high> and one participant id, return the other user id.
 */
function partnerFromDmConversationId(conversationId, userId) {
    if (conversationId == null) return null;
    const convId = String(conversationId);
    if (!convId.startsWith('dm_')) return null;
    const parts = convId.split('_');
    if (parts.length !== 3) return null;
    const a = parseInt(parts[1], 10);
    const b = parseInt(parts[2], 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    const uid = parseInt(userId, 10);
    if (Number.isNaN(uid)) return null;
    if (a === uid) return b;
    if (b === uid) return a;
    return null;
}

/** Get list of user IDs that the current user has DM conversations with (for conversation list) */
async function getDmConversationPartnerIds(userId) {
    checkFirebase();
    const uid = parseInt(userId, 10);
    if (Number.isNaN(uid)) return [];
    const partnerIds = new Set();

    function addPartner(rawId) {
        const p = parseInt(rawId, 10);
        if (!Number.isNaN(p) && p !== uid) partnerIds.add(p);
    }

    function collectFromSentDocs(docs) {
        docs.forEach(doc => {
            const d = doc.data();
            const convId = d.conversationId != null ? String(d.conversationId) : '';
            if (!convId.startsWith('dm_')) return;
            if (d.recipientId != null && d.recipientId !== '') {
                addPartner(d.recipientId);
            } else {
                const other = partnerFromDmConversationId(convId, uid);
                if (other != null) addPartner(other);
            }
        });
    }

    // Only DMs set recipientId in this app — don’t require conversationId (legacy/malformed docs).
    function collectFromReceivedDocs(docs) {
        docs.forEach(doc => {
            const d = doc.data();
            if (d.senderId != null && d.senderId !== '') {
                addPartner(d.senderId);
            }
        });
    }

    // Query number and string forms — Firestore equality is type-sensitive; older data may differ.
    const [sentN, sentS, recvN, recvS] = await Promise.all([
        db.collection(COLLECTIONS.MESSAGES).where('senderId', '==', uid).get(),
        db.collection(COLLECTIONS.MESSAGES).where('senderId', '==', String(uid)).get(),
        db.collection(COLLECTIONS.MESSAGES).where('recipientId', '==', uid).get(),
        db.collection(COLLECTIONS.MESSAGES).where('recipientId', '==', String(uid)).get()
    ]);

    collectFromSentDocs(sentN.docs);
    collectFromSentDocs(sentS.docs);
    collectFromReceivedDocs(recvN.docs);
    collectFromReceivedDocs(recvS.docs);

    return Array.from(partnerIds);
}

function teamIdsFromUserForChat(user) {
    if (!user) return [];
    if (Array.isArray(user.teamIds) && user.teamIds.length) {
        return user.teamIds.map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n));
    }
    if (user.teamId != null && user.teamId !== '') {
        const t = parseInt(user.teamId, 10);
        return Number.isNaN(t) ? [] : [t];
    }
    return [];
}

function messageCreatedAtMs(m) {
    if (!m || !m.createdAt) return 0;
    const t = new Date(m.createdAt).getTime();
    return Number.isNaN(t) ? 0 : t;
}

/** Ensure chatLastRead exists so unread counts don’t treat all history as new. */
async function ensureUserChatLastRead(userId) {
    const uid = typeof userId === 'number' ? userId : parseInt(userId, 10);
    if (Number.isNaN(uid)) return null;
    let user = await getUserById(uid);
    if (!user) return null;
    if (user.chatLastRead && typeof user.chatLastRead.general === 'string') return user;
    const now = new Date().toISOString();
    await updateUser(uid, {
        chatLastRead: { general: now, dm: {}, team: {} }
    });
    return await getUserById(uid);
}

const CHAT_UNREAD_MSG_LIMIT = 250;

/**
 * DM inbox: users you’ve already exchanged messages with, newest activity first (Instagram-style).
 */
async function getDmPartnersList(userId) {
    checkFirebase();
    const uid = parseInt(userId, 10);
    if (Number.isNaN(uid)) return [];
    const partnerIds = await getDmConversationPartnerIds(uid);
    const rows = [];
    for (const pid of partnerIds) {
        const pnum = parseInt(pid, 10);
        if (Number.isNaN(pnum) || pnum === uid) continue;
        const u = await getUserById(pnum);
        if (!u || u.role === 'super_admin') continue;
        const convId = getDmConversationId(uid, pnum);
        const msgs = await getMessagesByConversation(convId, CHAT_UNREAD_MSG_LIMIT);
        const last = msgs.length ? msgs[msgs.length - 1] : null;
        rows.push({
            id: u.id,
            username: u.username,
            firstName: u.firstName || '',
            lastName: u.lastName || '',
            lastMessageAt: last ? last.createdAt : null,
            _sort: messageCreatedAtMs(last)
        });
    }
    rows.sort((a, b) => b._sort - a._sort);
    return rows.map(({ _sort, ...rest }) => rest);
}

/**
 * Per-channel unread counts since last read.
 * Missing dm/team keys use chatLastRead.general as cutoff (same moment tracking started).
 */
async function getChatUnreadSummary(userId) {
    checkFirebase();
    const uid = typeof userId === 'number' ? userId : parseInt(userId, 10);
    if (Number.isNaN(uid)) {
        return { general: 0, dm: {}, team: {}, total: 0 };
    }

    const user = await ensureUserChatLastRead(uid);
    if (!user) {
        return { general: 0, dm: {}, team: {}, total: 0 };
    }

    const cr = user.chatLastRead || {};
    const generalCutMs = cr.general ? new Date(cr.general).getTime() : 0;
    const defaultCutMs = generalCutMs;

    const generalMsgs = await getMessagesByConversation('general', CHAT_UNREAD_MSG_LIMIT);
    let generalCount = 0;
    for (const m of generalMsgs) {
        if (messageCreatedAtMs(m) > generalCutMs) generalCount++;
    }

    const dmCounts = {};
    const partnerIds = await getDmConversationPartnerIds(uid);
    for (const pid of partnerIds) {
        const pKey = String(pid);
        const peerCutStr = (cr.dm && cr.dm[pKey]) ? cr.dm[pKey] : cr.general;
        const peerCutMs = peerCutStr ? new Date(peerCutStr).getTime() : defaultCutMs;
        const convId = getDmConversationId(uid, pid);
        const msgs = await getMessagesByConversation(convId, CHAT_UNREAD_MSG_LIMIT);
        let c = 0;
        for (const m of msgs) {
            if (parseInt(m.senderId, 10) === parseInt(pid, 10) && messageCreatedAtMs(m) > peerCutMs) {
                c++;
            }
        }
        if (c > 0) dmCounts[pKey] = c;
    }

    const teamCounts = {};
    const teamIds = teamIdsFromUserForChat(user);
    for (const tid of teamIds) {
        const tKey = String(tid);
        const teamCutStr = (cr.team && cr.team[tKey]) ? cr.team[tKey] : cr.general;
        const teamCutMs = teamCutStr ? new Date(teamCutStr).getTime() : defaultCutMs;
        const convId = `team_${tid}`;
        const msgs = await getMessagesByConversation(convId, CHAT_UNREAD_MSG_LIMIT);
        let c = 0;
        for (const m of msgs) {
            if (parseInt(m.senderId, 10) !== uid && messageCreatedAtMs(m) > teamCutMs) {
                c++;
            }
        }
        if (c > 0) teamCounts[tKey] = c;
    }

    const totalDm = Object.values(dmCounts).reduce((a, b) => a + b, 0);
    const totalTeam = Object.values(teamCounts).reduce((a, b) => a + b, 0);
    const total = generalCount + totalDm + totalTeam;

    return { general: generalCount, dm: dmCounts, team: teamCounts, total };
}

/**
 * @param {'general'|'dm'|'team'} channel
 * @param {{ otherUserId?: number|string, teamId?: number|string }} opts
 */
async function markChatLastRead(userId, channel, opts = {}) {
    checkFirebase();
    const uid = typeof userId === 'number' ? userId : parseInt(userId, 10);
    if (Number.isNaN(uid)) throw new Error('Invalid user');

    await ensureUserChatLastRead(uid);
    const now = new Date().toISOString();
    const userRef = db.collection(COLLECTIONS.USERS).doc(String(uid));

    if (channel === 'general') {
        await userRef.update({ 'chatLastRead.general': now });
        return;
    }
    if (channel === 'dm') {
        const oid = opts.otherUserId;
        if (oid == null || oid === '') throw new Error('otherUserId required');
        const pid = parseInt(oid, 10);
        if (Number.isNaN(pid)) throw new Error('Invalid otherUserId');
        await userRef.update({ [`chatLastRead.dm.${pid}`]: now });
        return;
    }
    if (channel === 'team') {
        const tid = opts.teamId;
        if (tid == null || tid === '') throw new Error('teamId required');
        const teamNum = parseInt(tid, 10);
        if (Number.isNaN(teamNum)) throw new Error('Invalid teamId');
        await userRef.update({ [`chatLastRead.team.${teamNum}`]: now });
        return;
    }
    throw new Error('Invalid channel');
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
            { name: 'No plastic for 3 days', description: 'Avoid single-use plastics for three days when eating on the go. Photo: your meal setup using only reusables (utensils, bottle, container).', points: 50, category: 'Reduce', difficulty: 'Medium', duration: '3 days', co2Saved: 2.5 },
            { name: 'Campus litter walk', description: 'Walk on campus and pick up litter; bin it correctly. Photo: you holding a bag or handful of collected litter near a campus bin.', points: 45, category: 'Nature', difficulty: 'Easy', duration: '1 day', co2Saved: 1.2 },
            { name: 'Bike to class', description: 'Ride a bike to campus instead of driving or being driven. Photo: your bike at a campus bike rack with a campus building in frame.', points: 35, category: 'Transport', difficulty: 'Easy', duration: '1 day', co2Saved: 1.8 },
            { name: 'Meatless Monday', description: 'Eat only plant-based meals today. Photo: your vegetarian or vegan meal (dining hall tray or plate).', points: 25, category: 'Food', difficulty: 'Easy', duration: '1 day', co2Saved: 3.6 },
            { name: 'Zero-waste snack kit', description: 'Pack snacks for the week using only reusables—no single-use wrappers. Photo: your open bag showing reusable containers/cloth napkin/snacks.', points: 55, category: 'Reduce', difficulty: 'Medium', duration: '7 days', co2Saved: 4.5 },
            { name: 'Phantom load patrol', description: 'Turn off a power strip or unplug chargers and small devices not in use in your room. Photo: power strip switched off or unplugged chargers laid out visible.', points: 35, category: 'Energy', difficulty: 'Easy', duration: '1 day', co2Saved: 1.5 }
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
    getUsersWithChallengeInActive,
    deleteUser,
    followUser,
    unfollowUser,
    isFollowing,
    getFollowersCount,
    getFollowingCount,
    
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

    // Team join request operations
    createTeamJoinRequest,
    getTeamJoinRequestsByTeamId,
    getTeamJoinRequestByUserAndTeam,
    getTeamJoinRequestById,
    updateTeamJoinRequest,
    getUserPendingTeamJoinRequestTeamIds,

    createTeamMemberInvite,
    getTeamMemberInviteById,
    getPendingTeamMemberInviteByTeamAndInvitee,
    getPendingTeamMemberInvitesForInvitee,
    getPendingTeamMemberInvitesForTeam,
    updateTeamMemberInvite,
    
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
    deleteEvidence,
    
    // Message operations
    getDmConversationId,
    getMessagesByConversation,
    createMessage,
    getDmConversationPartnerIds,
    getDmPartnersList,
    getChatUnreadSummary,
    markChatLastRead,
    getAllMessages,
    getMessageById,
    deleteMessage,
    updateMessage
};
