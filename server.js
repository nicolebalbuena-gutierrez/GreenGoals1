const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

// Import Firebase service module
const firebaseService = require('./firebase-service');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'greengoals-secret-key-2025';

// OpenAI API Key - Replace 'YOUR_OPENAI_API_KEY_HERE' with your actual key from platform.openai.com
// Example: const OPENAI_API_KEY = 'sk-proj-abc123...';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY_HERE';

// NewsAPI Key for fetching live sustainability news
const NEWS_API_KEY = process.env.NEWS_API_KEY || '2d0395b0d6634347858b6000239d74fe';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for image uploads
app.use(express.static('public'));

// Simple JWT auth (no Firebase Auth - works like before)
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { userId: decoded.userId };
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}

// Admin: same JWT, then check role in database
async function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await firebaseService.getUserById(decoded.userId);
        if (!user || user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        req.user = { userId: user.id };
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}

// ============================================
// AUTH ROUTES (simple username/password + JWT, no Firebase Auth)
// ============================================

// Login - username or email + password
app.post('/api/login', async (req, res) => {
    try {
        const { usernameOrEmail, password } = req.body;
        if (!usernameOrEmail || !password) {
            return res.status(400).json({ error: 'Username/email and password required' });
        }
        const input = String(usernameOrEmail).trim();
        const isEmail = input.includes('@');
        let user = isEmail
            ? await firebaseService.getUserByEmail(input)
            : await firebaseService.getUserByUsername(input);
        if (!user && !isEmail) {
            const allUsers = await firebaseService.getAllUsers();
            const lower = input.toLowerCase();
            user = allUsers.find(u => u.username && String(u.username).toLowerCase() === lower) || null;
        }
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }
        if (!user.password) {
            return res.status(400).json({ error: 'Invalid password' });
        }
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(400).json({ error: 'Invalid password' });
        }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET);
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                classYear: user.classYear,
                points: user.points || 0,
                isAdmin: user.role === 'super_admin'
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Register - no Firebase, just create user in Firestore with hashed password
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, firstName, lastName, classYear } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password required' });
        }
        if (await firebaseService.getUserByUsername(username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        if (await firebaseService.getUserByEmail(email)) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            username,
            email,
            password: hashedPassword,
            firstName: firstName || '',
            lastName: lastName || '',
            classYear: classYear || '',
            profilePicture: '',
            bio: '',
            points: 0,
            totalCO2Saved: 0,
            activeChallenges: [],
            completedChallenges: [],
            teamId: null,
            joinedAt: new Date().toISOString()
        };
        const createdUser = await firebaseService.createUser(newUser);
        const token = jwt.sign({ userId: createdUser.id }, JWT_SECRET);
        res.json({
            token,
            user: {
                id: createdUser.id,
                username,
                email,
                firstName: createdUser.firstName,
                lastName: createdUser.lastName,
                classYear: createdUser.classYear,
                points: 0,
                isAdmin: false
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await firebaseService.getUserByUsername(username);
        if (!user || user.role !== 'super_admin') {
            return res.status(400).json({ error: 'Admin not found' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid password' });
        }
        
        const token = jwt.sign({ userId: user.id, isAdmin: true }, JWT_SECRET);
        res.json({ 
            token, 
            user: { 
                id: user.id, 
                username: user.username, 
                role: user.role 
            } 
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Admin login failed' });
    }
});

// ============================================
// USER ROUTES
// ============================================

// Get all users (public - no passwords)
app.get('/api/users', async (req, res) => {
    try {
        const allUsers = await firebaseService.getAllUsers();
        // Filter out admin users from public list
        const users = allUsers
            .filter(u => u.role !== 'super_admin' && u.role !== 'admin')
            .map(u => ({
                id: u.id,
                username: u.username,
                firstName: u.firstName || '',
                lastName: u.lastName || '',
                classYear: u.classYear || '',
                profilePicture: u.profilePicture || '',
                bio: u.bio || '',
                points: u.points || 0,
                totalCO2Saved: u.totalCO2Saved || 0,
                completedChallenges: Array.isArray(u.completedChallenges) ? u.completedChallenges.length : 0,
                teamId: u.teamId || null,
                role: u.role || 'user'
            }));
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get user's pending evidence submissions (MUST be before /api/user/:id to avoid route conflict)
app.get('/api/user/pending-evidence', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const userEvidence = await firebaseService.getEvidenceByUserId(userId);
        // Don't send the full image back, just metadata
        const safeEvidence = userEvidence.map(e => ({
            id: e.id,
            challengeId: e.challengeId,
            challengeName: e.challengeName,
            status: e.status,
            submittedAt: e.submittedAt,
            reviewedAt: e.reviewedAt,
            reviewNotes: e.reviewNotes
        }));
        
        res.json(safeEvidence);
    } catch (error) {
        console.error('Error fetching pending evidence:', error);
        res.status(500).json({ error: 'Failed to fetch pending evidence' });
    }
});

// Get user's completed/approved evidence with images
app.get('/api/user/completed-evidence', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get user's approved evidence
        const allEvidence = await firebaseService.getEvidenceByUserId(userId);
        const completedEvidence = allEvidence.filter(e => e.status === 'approved');
        
        // Return with images
        res.json(completedEvidence);
    } catch (error) {
        console.error('Error fetching completed evidence:', error);
        res.status(500).json({ error: 'Failed to fetch completed evidence' });
    }
});

// Get current user profile (using Firebase token)
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = await firebaseService.getUserById(req.user.userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get full challenge details
        const allChallenges = await firebaseService.getAllChallenges();
        const activeChallenges = user.activeChallenges.map(cId => 
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        
        const completedChallenges = user.completedChallenges.map(cId => 
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            classYear: user.classYear,
            profilePicture: user.profilePicture,
            bio: user.bio,
            points: user.points,
            totalCO2Saved: user.totalCO2Saved,
            activeChallenges,
            completedChallenges,
            teamId: user.teamId,
            isAdmin: user.role === 'super_admin'
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

// Get user by ID
app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await firebaseService.getUserById(parseInt(req.params.id));
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get full challenge details
        const allChallenges = await firebaseService.getAllChallenges();
        const activeChallenges = user.activeChallenges.map(cId => 
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        
        const completedChallenges = user.completedChallenges.map(cId => 
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            classYear: user.classYear,
            profilePicture: user.profilePicture,
            bio: user.bio,
            points: user.points,
            totalCO2Saved: user.totalCO2Saved,
            activeChallenges,
            completedChallenges,
            teamId: user.teamId
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Update user profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const { profilePicture, bio, classYear } = req.body;
        const userId = req.user.userId;
        
        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const updates = {};
        if (profilePicture !== undefined) updates.profilePicture = profilePicture;
        if (bio !== undefined) updates.bio = bio;
        if (classYear !== undefined) updates.classYear = classYear;
        
        const updatedUser = await firebaseService.updateUser(userId, updates);
        
        res.json({ 
            message: 'Profile updated successfully',
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                profilePicture: updatedUser.profilePicture,
                bio: updatedUser.bio,
                classYear: updatedUser.classYear
            }
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ============================================
// CHAT ROUTES
// ============================================

// Delete own message (general chat only - user must be sender)
app.delete('/api/chat/messages/:id', authenticateToken, async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = req.user.userId;
        const message = await firebaseService.getMessageById(messageId);
        if (!message) return res.status(404).json({ error: 'Message not found' });
        // User can only delete their own messages
        if (parseInt(message.senderId) !== parseInt(userId)) {
            return res.status(403).json({ error: 'You can only delete your own posts' });
        }
        // Only allow deleting general chat posts (not DMs)
        if ((message.conversationId || '') !== 'general') {
            return res.status(403).json({ error: 'Can only delete posts from General Chat' });
        }
        await firebaseService.deleteMessage(messageId);
        res.json({ message: 'Post deleted' });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// Get general (group) chat messages
app.get('/api/chat/general', authenticateToken, async (req, res) => {
    try {
        const messages = await firebaseService.getMessagesByConversation('general');
        res.json(messages);
    } catch (error) {
        console.error('Error fetching general chat:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send message/post to general chat (supports text and/or image)
app.post('/api/chat/general', authenticateToken, async (req, res) => {
    try {
        const { text, imageBase64, imageMimeType } = req.body;
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const hasText = text && String(text).trim();
        const hasImage = imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 0;
        if (!hasText && !hasImage) return res.status(400).json({ error: 'Message text or image required' });

        const message = await firebaseService.createMessage('general', userId, user.username, text || '', null, imageBase64, imageMimeType);
        res.json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ============================================
// ADMIN CHAT MODERATION
// ============================================

// Get all chat messages (admin only - for moderation)
app.get('/api/admin/chat/messages', authenticateAdmin, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 200, 500);
        const messages = await firebaseService.getAllMessages(limit);
        res.json(messages);
    } catch (error) {
        console.error('Error fetching chat messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Delete a chat message (admin only - for moderation)
app.delete('/api/admin/chat/messages/:id', authenticateAdmin, async (req, res) => {
    try {
        await firebaseService.deleteMessage(req.params.id);
        res.json({ message: 'Message deleted' });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// Get DM conversation between current user and another user
app.get('/api/chat/dm/:otherUserId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const otherUserId = parseInt(req.params.otherUserId);
        const convId = firebaseService.getDmConversationId(userId, otherUserId);
        const messages = await firebaseService.getMessagesByConversation(convId);
        res.json(messages);
    } catch (error) {
        console.error('Error fetching DM:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send DM to another user
app.post('/api/chat/dm/:otherUserId', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        const userId = req.user.userId;
        const otherUserId = parseInt(req.params.otherUserId);
        const user = await firebaseService.getUserById(userId);
        const otherUser = await firebaseService.getUserById(otherUserId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!otherUser) return res.status(404).json({ error: 'Recipient not found' });
        if (!text || !String(text).trim()) return res.status(400).json({ error: 'Message text required' });

        const convId = firebaseService.getDmConversationId(userId, otherUserId);
        const message = await firebaseService.createMessage(convId, userId, user.username, text, otherUserId);
        res.json(message);
    } catch (error) {
        console.error('Error sending DM:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Get list of users for DM (all users except current, plus recent conversation partners first)
app.get('/api/chat/users', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const allUsers = await firebaseService.getAllUsers();
        const partnerIds = await firebaseService.getDmConversationPartnerIds(userId);
        
        const users = allUsers
            .filter(u => u.id !== userId && u.role !== 'super_admin')
            .map(u => ({
                id: u.id,
                username: u.username,
                firstName: u.firstName || '',
                lastName: u.lastName || ''
            }));
        
        // Sort: recent conversation partners first, then alphabetical by username
        users.sort((a, b) => {
            const aRecent = partnerIds.includes(a.id);
            const bRecent = partnerIds.includes(b.id);
            if (aRecent && !bRecent) return -1;
            if (!aRecent && bRecent) return 1;
            return (a.username || '').localeCompare(b.username || '');
        });
        
        res.json(users);
    } catch (error) {
        console.error('Error fetching chat users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ============================================
// CHALLENGE ROUTES
// ============================================

// Get all challenges
app.get('/api/challenges', async (req, res) => {
    try {
        const challenges = await firebaseService.getAllChallenges();
        res.json(challenges);
    } catch (error) {
        console.error('Error fetching challenges:', error);
        res.status(500).json({ error: 'Failed to fetch challenges' });
    }
});

// Accept a challenge
app.post('/api/challenges/:id/accept', authenticateToken, async (req, res) => {
    try {
        const challengeId = parseInt(req.params.id);
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        const challenge = await firebaseService.getChallengeById(challengeId);

        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }

        if (user.activeChallenges.includes(challengeId)) {
            return res.status(400).json({ error: 'Challenge already active' });
        }

        if (user.completedChallenges.includes(challengeId)) {
            return res.status(400).json({ error: 'Challenge already completed' });
        }

        const activeChallenges = [...(user.activeChallenges || []), challengeId];
        await firebaseService.updateUser(userId, { activeChallenges });

        res.json({ message: `Started: ${challenge.name}`, challenge });
    } catch (error) {
        console.error('Error accepting challenge:', error);
        res.status(500).json({ error: 'Failed to accept challenge' });
    }
});

// Abandon a challenge (remove from active challenges)
app.post('/api/challenges/:id/abandon', authenticateToken, async (req, res) => {
    try {
        const challengeId = parseInt(req.params.id);
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        const challenge = await firebaseService.getChallengeById(challengeId);

        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }

        const index = user.activeChallenges.indexOf(challengeId);
        if (index === -1) {
            return res.status(400).json({ error: 'Challenge is not in your active challenges' });
        }

        // Remove from active challenges
        const activeChallenges = user.activeChallenges.filter(id => id !== challengeId);
        await firebaseService.updateUser(userId, { activeChallenges });

        res.json({ message: `Abandoned: ${challenge.name}. You can start it again anytime!` });
    } catch (error) {
        console.error('Error abandoning challenge:', error);
        res.status(500).json({ error: 'Failed to abandon challenge' });
    }
});

// Complete a challenge (direct - for admin or testing)
app.post('/api/challenges/:id/complete', authenticateToken, async (req, res) => {
    try {
        const challengeId = parseInt(req.params.id);
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        const challenge = await firebaseService.getChallengeById(challengeId);

        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }

        if (!user.activeChallenges.includes(challengeId)) {
            return res.status(400).json({ error: 'Challenge not active' });
        }

        // Remove from active, add to completed
        const activeChallenges = user.activeChallenges.filter(id => id !== challengeId);
        const completedChallenges = [...(user.completedChallenges || []), challengeId];
        const newPoints = (user.points || 0) + challenge.points;
        const newCO2Saved = (user.totalCO2Saved || 0) + challenge.co2Saved;

        await firebaseService.updateUser(userId, {
            activeChallenges,
            completedChallenges,
            points: newPoints,
            totalCO2Saved: newCO2Saved
        });

        // Update team points if user is in a team
        if (user.teamId) {
            const team = await firebaseService.getTeamById(user.teamId);
            if (team) {
                await firebaseService.updateTeam(user.teamId, {
                    totalPoints: (team.totalPoints || 0) + challenge.points
                });
            }
        }

        res.json({ 
            message: `Completed: ${challenge.name}! +${challenge.points} points, ${challenge.co2Saved}kg CO₂ saved!`,
            user: {
                points: newPoints,
                totalCO2Saved: newCO2Saved,
                completedChallenges
            }
        });
    } catch (error) {
        console.error('Error completing challenge:', error);
        res.status(500).json({ error: 'Failed to complete challenge' });
    }
});

// Submit evidence for a challenge (sends to admin for approval)
app.post('/api/challenges/:id/submit-evidence', authenticateToken, async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        const challengeId = parseInt(req.params.id);
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        const challenge = await firebaseService.getChallengeById(challengeId);

        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }

        if (!user.activeChallenges.includes(challengeId)) {
            return res.status(400).json({ error: 'Challenge not in progress' });
        }

        if (!imageBase64) {
            return res.status(400).json({ error: 'Please provide an image' });
        }

        // Check if user already submitted evidence for this challenge
        const userEvidence = await firebaseService.getEvidenceByUserId(userId);
        const existingSubmission = userEvidence.find(
            e => e.challengeId === challengeId && e.status === 'pending'
        );
        
        if (existingSubmission) {
            return res.status(400).json({ error: 'You already have a pending submission for this challenge. Please wait for admin review.' });
        }

        // Create new evidence submission
        const newEvidence = {
            userId: userId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            challengeId: challengeId,
            challengeName: challenge.name,
            challengePoints: challenge.points,
            challengeCO2: challenge.co2Saved,
            imageBase64: imageBase64,
            status: 'pending', // pending, approved, rejected
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            reviewNotes: null
        };

        const createdEvidence = await firebaseService.createEvidence(newEvidence);

        return res.json({
            pending: true,
            message: `📤 Evidence submitted! Your submission for "${challenge.name}" is now pending admin approval.`,
            submissionId: createdEvidence.id
        });
    } catch (error) {
        console.error('Error submitting evidence:', error);
        res.status(500).json({ error: 'Failed to submit evidence' });
    }
});

// Admin: Get all pending evidence
app.get('/api/admin/pending-evidence', authenticateAdmin, async (req, res) => {
    try {
        const pendingOnly = await firebaseService.getAllPendingEvidence();
        res.json(pendingOnly);
    } catch (error) {
        console.error('Error fetching pending evidence:', error);
        res.status(500).json({ error: 'Failed to fetch pending evidence' });
    }
});

// Admin: Get all evidence (including reviewed) - with images
app.get('/api/admin/all-evidence', authenticateAdmin, async (req, res) => {
    try {
        const allEvidence = await firebaseService.getAllEvidence();
        res.json(allEvidence);
    } catch (error) {
        console.error('Error fetching all evidence:', error);
        res.status(500).json({ error: 'Failed to fetch evidence' });
    }
});

// Admin: Approve evidence
app.post('/api/admin/evidence/:id/approve', authenticateAdmin, async (req, res) => {
    try {
        const { notes } = req.body;
        const evidenceId = parseInt(req.params.id);
        
        const evidence = await firebaseService.getEvidenceById(evidenceId);
        if (!evidence) {
            return res.status(404).json({ error: 'Evidence not found' });
        }
        
        if (evidence.status !== 'pending') {
            return res.status(400).json({ error: 'Evidence already reviewed' });
        }
        
        // Find user and challenge
        const user = await firebaseService.getUserById(evidence.userId);
        const challenge = await firebaseService.getChallengeById(evidence.challengeId);
        
        if (!user || !challenge) {
            return res.status(404).json({ error: 'User or challenge not found' });
        }
        
        // Complete the challenge for the user
        const activeChallenges = user.activeChallenges.filter(id => id !== evidence.challengeId);
        const completedChallenges = user.completedChallenges.includes(evidence.challengeId) 
            ? user.completedChallenges 
            : [...user.completedChallenges, evidence.challengeId];
        const newPoints = (user.points || 0) + challenge.points;
        const newCO2Saved = (user.totalCO2Saved || 0) + challenge.co2Saved;
        
        await firebaseService.updateUser(evidence.userId, {
            activeChallenges,
            completedChallenges,
            points: newPoints,
            totalCO2Saved: newCO2Saved
        });
        
        // Update team points
        if (user.teamId) {
            const team = await firebaseService.getTeamById(user.teamId);
            if (team) {
                await firebaseService.updateTeam(user.teamId, {
                    totalPoints: (team.totalPoints || 0) + challenge.points
                });
            }
        }
        
        // Update evidence status
        await firebaseService.updateEvidence(evidenceId, {
            status: 'approved',
            reviewedAt: new Date().toISOString(),
            reviewNotes: notes || 'Approved by admin',
            imageBase64: '[APPROVED - IMAGE ARCHIVED]' // Clear the image data to save space
        });
        
        res.json({ 
            message: `Approved! ${user.firstName || user.username} earned ${challenge.points} points for "${challenge.name}"`,
            evidence: {
                id: evidenceId,
                status: 'approved',
                reviewedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error approving evidence:', error);
        res.status(500).json({ error: 'Failed to approve evidence' });
    }
});

// Admin: Reject evidence
app.post('/api/admin/evidence/:id/reject', authenticateAdmin, async (req, res) => {
    try {
        const { notes } = req.body;
        const evidenceId = parseInt(req.params.id);
        
        const evidence = await firebaseService.getEvidenceById(evidenceId);
        if (!evidence) {
            return res.status(404).json({ error: 'Evidence not found' });
        }
        
        if (evidence.status !== 'pending') {
            return res.status(400).json({ error: 'Evidence already reviewed' });
        }
        
        // Update evidence status (challenge stays in progress so user can try again)
        await firebaseService.updateEvidence(evidenceId, {
            status: 'rejected',
            reviewedAt: new Date().toISOString(),
            reviewNotes: notes || 'Rejected by admin',
            imageBase64: '[REJECTED - IMAGE ARCHIVED]' // Clear the image data
        });
        
        res.json({ 
            message: `Evidence rejected. User can submit new evidence.`,
            evidence: {
                id: evidenceId,
                status: 'rejected',
                reviewedAt: new Date().toISOString(),
                reviewNotes: notes || 'Rejected by admin'
            }
        });
    } catch (error) {
        console.error('Error rejecting evidence:', error);
        res.status(500).json({ error: 'Failed to reject evidence' });
    }
});

// Get user's challenges
app.get('/api/user/challenges', authenticateToken, async (req, res) => {
    try {
        const user = await firebaseService.getUserById(req.user.userId);
        const allChallenges = await firebaseService.getAllChallenges();
        
        const activeChallenges = user.activeChallenges.map(cId => 
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        
        const completedChallenges = user.completedChallenges.map(cId => 
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        
        res.json({ activeChallenges, completedChallenges });
    } catch (error) {
        console.error('Error fetching user challenges:', error);
        res.status(500).json({ error: 'Failed to fetch challenges' });
    }
});

// ============================================
// TEAM ROUTES
// ============================================

// Get all teams
app.get('/api/teams', async (req, res) => {
    try {
        const teams = await firebaseService.getAllTeams();
        const allUsers = await firebaseService.getAllUsers();
        const teamsWithMembers = teams.map(t => ({
            ...t,
            memberCount: allUsers.filter(u => u.teamId === t.id).length
        }));
        res.json(teamsWithMembers);
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});

// Create a team
app.post('/api/teams', authenticateToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        if (user.teamId) {
            return res.status(400).json({ error: 'Already in a team' });
        }

        const newTeam = {
            name,
            description,
            leaderId: userId,
            totalPoints: user.points || 0,
            createdAt: new Date().toISOString()
        };

        const createdTeam = await firebaseService.createTeam(newTeam);
        await firebaseService.updateUser(userId, { teamId: createdTeam.id });

        res.json({ message: 'Team created!', team: createdTeam });
    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: 'Failed to create team' });
    }
});

// Join a team
app.post('/api/teams/:id/join', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        const team = await firebaseService.getTeamById(teamId);

        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        if (user.teamId) {
            return res.status(400).json({ error: 'Already in a team' });
        }

        await firebaseService.updateUser(userId, { teamId });
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (user.points || 0)
        });

        const updatedTeam = await firebaseService.getTeamById(teamId);
        res.json({ message: `Joined team: ${team.name}!`, team: updatedTeam });
    } catch (error) {
        console.error('Error joining team:', error);
        res.status(500).json({ error: 'Failed to join team' });
    }
});

// Leave team
app.post('/api/teams/leave', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        if (!user.teamId) {
            return res.status(400).json({ error: 'Not in a team' });
        }

        const team = await firebaseService.getTeamById(user.teamId);
        if (team) {
            await firebaseService.updateTeam(user.teamId, {
                totalPoints: Math.max(0, (team.totalPoints || 0) - (user.points || 0))
            });
        }

        await firebaseService.updateUser(userId, { teamId: null });

        res.json({ message: 'Left team successfully' });
    } catch (error) {
        console.error('Error leaving team:', error);
        res.status(500).json({ error: 'Failed to leave team' });
    }
});

// Add member to team (team leader can add users)
app.post('/api/teams/:id/add-member', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.body;
        const teamId = parseInt(req.params.id);
        const requesterId = req.user.userId;

        const requester = await firebaseService.getUserById(requesterId);
        const team = await firebaseService.getTeamById(teamId);
        const userToAdd = await firebaseService.getUserById(userId);

        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        if (!userToAdd) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if requester is team leader or member of the team
        if (requester.teamId !== teamId) {
            return res.status(403).json({ error: 'You must be a team member to add others' });
        }

        if (userToAdd.teamId) {
            return res.status(400).json({ error: 'User is already in a team' });
        }

        // Add user to team
        await firebaseService.updateUser(userId, { teamId });
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (userToAdd.points || 0)
        });

        const updatedTeam = await firebaseService.getTeamById(teamId);
        res.json({ 
            message: `${userToAdd.firstName || userToAdd.username} has been added to ${team.name}!`,
            team: updatedTeam
        });
    } catch (error) {
        console.error('Error adding team member:', error);
        res.status(500).json({ error: 'Failed to add team member' });
    }
});

// ============================================
// LEADERBOARD & STATS
// ============================================

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const allUsers = await firebaseService.getAllUsers();
        // Filter out admin users from leaderboard
        const leaderboard = allUsers
            .filter(u => u.role !== 'super_admin' && u.role !== 'admin')
            .map(u => ({
                id: u.id,
                username: u.username,
                firstName: u.firstName,
                lastName: u.lastName,
                classYear: u.classYear,
                profilePicture: u.profilePicture,
                points: u.points || 0,
                totalCO2Saved: u.totalCO2Saved || 0,
                completedChallenges: Array.isArray(u.completedChallenges) ? u.completedChallenges.length : 0,
                role: u.role
            }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);
        
        res.json(leaderboard);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Get team leaderboard
app.get('/api/leaderboard/teams', async (req, res) => {
    try {
        const teams = await firebaseService.getAllTeams();
        const allUsers = await firebaseService.getAllUsers();
        const teamLeaderboard = teams
            .map(t => ({
                ...t,
                memberCount: allUsers.filter(u => u.teamId === t.id).length
            }))
            .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
            .slice(0, 10);
        
        res.json(teamLeaderboard);
    } catch (error) {
        console.error('Error fetching team leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch team leaderboard' });
    }
});

// Get platform stats
app.get('/api/stats', async (req, res) => {
    try {
        const allUsers = await firebaseService.getAllUsers();
        const teams = await firebaseService.getAllTeams();
        const challenges = await firebaseService.getAllChallenges();
        
        // Filter out admin users from stats
        const regularUsers = allUsers.filter(u => u.role !== 'super_admin' && u.role !== 'admin');
        const totalUsers = regularUsers.length;
        const totalCO2Saved = regularUsers.reduce((sum, u) => sum + (u.totalCO2Saved || 0), 0);
        const totalChallengesCompleted = regularUsers.reduce((sum, u) => {
            const completed = u.completedChallenges;
            if (Array.isArray(completed)) {
                return sum + completed.length;
            }
            return sum + (completed || 0);
        }, 0);
        const totalTeams = teams.length;
        const totalChallenges = challenges.length;
        
        res.json({
            totalUsers,
            totalCO2Saved: totalCO2Saved.toFixed(1),
            totalChallengesCompleted,
            totalTeams,
            totalChallenges
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Admin: Get all challenges
app.get('/api/admin/challenges', authenticateAdmin, async (req, res) => {
    try {
        const challenges = await firebaseService.getAllChallenges();
        res.json(challenges);
    } catch (error) {
        console.error('Error fetching challenges:', error);
        res.status(500).json({ error: 'Failed to fetch challenges' });
    }
});

// Admin: Add new challenge
app.post('/api/admin/challenges', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, points, category, difficulty, duration, co2Saved } = req.body;
        
        const newChallenge = {
            name,
            description,
            points: parseInt(points),
            category,
            difficulty,
            duration,
            co2Saved: parseFloat(co2Saved)
        };
        
        const createdChallenge = await firebaseService.createChallenge(newChallenge);
        
        res.json({ message: 'Challenge created!', challenge: createdChallenge });
    } catch (error) {
        console.error('Error creating challenge:', error);
        res.status(500).json({ error: 'Failed to create challenge' });
    }
});

// Admin: Update challenge
app.put('/api/admin/challenges/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, points, category, difficulty, duration, co2Saved } = req.body;
        const challengeId = parseInt(req.params.id);
        
        const challenge = await firebaseService.getChallengeById(challengeId);
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }
        
        const updates = {};
        if (name) updates.name = name;
        if (description) updates.description = description;
        if (points) updates.points = parseInt(points);
        if (category) updates.category = category;
        if (difficulty) updates.difficulty = difficulty;
        if (duration) updates.duration = duration;
        if (co2Saved) updates.co2Saved = parseFloat(co2Saved);
        
        const updatedChallenge = await firebaseService.updateChallenge(challengeId, updates);
        
        res.json({ message: 'Challenge updated!', challenge: updatedChallenge });
    } catch (error) {
        console.error('Error updating challenge:', error);
        res.status(500).json({ error: 'Failed to update challenge' });
    }
});

// Admin: Delete challenge
app.delete('/api/admin/challenges/:id', authenticateAdmin, async (req, res) => {
    try {
        const challengeId = parseInt(req.params.id);
        
        const challenge = await firebaseService.getChallengeById(challengeId);
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }
        
        await firebaseService.deleteChallenge(challengeId);
        
        res.json({ message: 'Challenge deleted!' });
    } catch (error) {
        console.error('Error deleting challenge:', error);
        res.status(500).json({ error: 'Failed to delete challenge' });
    }
});

// Admin: Get all users
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const allUsers = await firebaseService.getAllUsers();
        const users = allUsers.map(u => ({
            id: u.id,
            username: u.username,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            classYear: u.classYear,
            points: u.points || 0,
            totalCO2Saved: u.totalCO2Saved || 0,
            activeChallenges: Array.isArray(u.activeChallenges) ? u.activeChallenges.length : 0,
            completedChallenges: Array.isArray(u.completedChallenges) ? u.completedChallenges.length : 0,
            teamId: u.teamId,
            role: u.role || 'user'
        }));
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Admin: Delete user
app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        
        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Don't allow deleting admin
        if (user.role === 'super_admin') {
            return res.status(400).json({ error: 'Cannot delete admin user' });
        }
        
        await firebaseService.deleteUser(userId);
        
        res.json({ message: 'User deleted!' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Admin: Get all teams
app.get('/api/admin/teams', authenticateAdmin, async (req, res) => {
    try {
        const teams = await firebaseService.getAllTeams();
        const allUsers = await firebaseService.getAllUsers();
        
        const teamsWithDetails = await Promise.all(teams.map(async (t) => {
            // Get leader info
            const leader = await firebaseService.getUserById(t.leaderId);
            
            // Get member info - handle undefined members array
            const memberIds = Array.isArray(t.members) ? t.members : [];
            const members = memberIds.map(memberId => {
                const user = allUsers.find(u => u.id === memberId);
                return user ? {
                    id: user.id,
                    firstName: user.firstName || '',
                    lastName: user.lastName || '',
                    username: user.username
                } : null;
            }).filter(m => m !== null);
            
            // Also include users who have this teamId but aren't in members array
            allUsers.forEach(u => {
                if (u.teamId === t.id && !members.find(m => m.id === u.id)) {
                    members.push({
                        id: u.id,
                        firstName: u.firstName || '',
                        lastName: u.lastName || '',
                        username: u.username
                    });
                }
            });
            
            return {
                id: t.id,
                name: t.name,
                description: t.description || '',
                leaderId: t.leaderId,
                leaderName: leader ? `${leader.firstName || ''} ${leader.lastName || ''}`.trim() : 'Unknown',
                leaderUsername: leader ? leader.username : 'unknown',
                members: members,
                memberCount: members.length,
                totalPoints: t.totalPoints || 0,
                createdAt: t.createdAt
            };
        }));
        
        res.json(teamsWithDetails);
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});

// Admin: Update team
app.put('/api/admin/teams/:id', authenticateAdmin, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const { name, description } = req.body;
        
        const team = await firebaseService.getTeamById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        const updates = {};
        if (name) updates.name = name;
        if (description !== undefined) updates.description = description;
        
        const updatedTeam = await firebaseService.updateTeam(teamId, updates);
        
        res.json({ message: 'Team updated!', team: updatedTeam });
    } catch (error) {
        console.error('Error updating team:', error);
        res.status(500).json({ error: 'Failed to update team' });
    }
});

// Admin: Delete team
app.delete('/api/admin/teams/:id', authenticateAdmin, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        
        const team = await firebaseService.getTeamById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        // Remove teamId from all members
        const allUsers = await firebaseService.getAllUsers();
        const teamMembers = allUsers.filter(u => u.teamId === teamId);
        
        await Promise.all(teamMembers.map(user => 
            firebaseService.updateUser(user.id, { teamId: null })
        ));
        
        // Remove the team
        await firebaseService.deleteTeam(teamId);
        
        res.json({ message: 'Team deleted!' });
    } catch (error) {
        console.error('Error deleting team:', error);
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

// Admin: Remove member from team
app.post('/api/admin/teams/:id/remove-member', authenticateAdmin, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const { userId } = req.body;
        
        const team = await firebaseService.getTeamById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        // Can't remove the leader
        if (team.leaderId === userId) {
            return res.status(400).json({ error: 'Cannot remove team leader. Delete the team instead.' });
        }
        
        // Update user's teamId
        await firebaseService.updateUser(userId, { teamId: null });
        
        res.json({ message: 'Member removed from team!' });
    } catch (error) {
        console.error('Error removing team member:', error);
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});

// ============================================
// CAMPUS UPDATES ROUTES
// ============================================

// Get all campus updates (public)
app.get('/api/updates', async (req, res) => {
    try {
        const updates = await firebaseService.getAllUpdates();
        res.json(updates);
    } catch (error) {
        console.error('Error fetching updates:', error);
        res.status(500).json({ error: 'Failed to fetch updates' });
    }
});

// Admin: Get all updates
app.get('/api/admin/updates', authenticateAdmin, async (req, res) => {
    try {
        const updates = await firebaseService.getAllUpdates();
        res.json(updates);
    } catch (error) {
        console.error('Error fetching updates:', error);
        res.status(500).json({ error: 'Failed to fetch updates' });
    }
});

// Admin: Create new update
app.post('/api/admin/updates', authenticateAdmin, async (req, res) => {
    try {
        const { title, content, icon } = req.body;
        
        const newUpdate = {
            title,
            content,
            icon: icon || '🌱',
            createdAt: new Date().toISOString()
        };
        
        const createdUpdate = await firebaseService.createUpdate(newUpdate);
        
        res.json({ message: 'Update created!', update: createdUpdate });
    } catch (error) {
        console.error('Error creating update:', error);
        res.status(500).json({ error: 'Failed to create update' });
    }
});

// Admin: Update an update
app.put('/api/admin/updates/:id', authenticateAdmin, async (req, res) => {
    try {
        const { title, content, icon } = req.body;
        const updateId = parseInt(req.params.id);
        
        const update = await firebaseService.getAllUpdates();
        const foundUpdate = update.find(u => u.id === updateId);
        if (!foundUpdate) {
            return res.status(404).json({ error: 'Update not found' });
        }
        
        const updates = {};
        if (title) updates.title = title;
        if (content) updates.content = content;
        if (icon) updates.icon = icon;
        updates.updatedAt = new Date().toISOString();
        
        const updatedUpdate = await firebaseService.updateUpdate(updateId, updates);
        
        res.json({ message: 'Update modified!', update: updatedUpdate });
    } catch (error) {
        console.error('Error updating update:', error);
        res.status(500).json({ error: 'Failed to update update' });
    }
});

// Admin: Delete an update
app.delete('/api/admin/updates/:id', authenticateAdmin, async (req, res) => {
    try {
        const updateId = parseInt(req.params.id);
        
        await firebaseService.deleteUpdate(updateId);
        
        res.json({ message: 'Update deleted!' });
    } catch (error) {
        console.error('Error deleting update:', error);
        res.status(500).json({ error: 'Failed to delete update' });
    }
});

// ============================================
// NEWS API ROUTES
// ============================================

// Get live sustainability news
app.get('/api/news', async (req, res) => {
    try {
        // Search for environmental news with specific terms
        const searchTerms = '("climate change" OR "global warming" OR "renewable energy" OR "carbon footprint" OR "electric vehicle" OR "solar energy" OR "wind power" OR "sustainability" OR "zero emissions")';
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchTerms)}&sortBy=relevancy&pageSize=12&language=en&apiKey=${NEWS_API_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.status === 'error') {
            console.error('NewsAPI error:', data.message);
            return res.status(500).json({ error: data.message });
        }
        
        // Filter and format articles - only keep relevant ones
        const relevantKeywords = ['climate', 'environment', 'sustainable', 'renewable', 'solar', 'wind', 'carbon', 'emission', 'electric vehicle', 'ev', 'green', 'eco', 'recycle', 'pollution', 'energy'];
        
        const articles = data.articles
            .filter(article => {
                const text = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
                return relevantKeywords.some(keyword => text.includes(keyword));
            })
            .slice(0, 6)
            .map(article => ({
                title: article.title,
                description: article.description,
                url: article.url,
                image: article.urlToImage,
                source: article.source.name,
                publishedAt: article.publishedAt
            }));
        
        res.json(articles);
    } catch (error) {
        console.error('Error fetching news:', error);
        res.status(500).json({ error: 'Failed to fetch news' });
    }
});

// ============================================
// DATABASE ROUTES (for debugging)
// ============================================

// Get raw database
app.get('/api/database/raw', async (req, res) => {
    try {
        const db = await firebaseService.readDatabase();
        // Remove passwords for security
        const safeDb = {
            ...db,
            users: db.users.map(u => ({ ...u, password: '[HIDDEN]' }))
        };
        res.json(safeDb);
    } catch (error) {
        console.error('Error fetching database:', error);
        res.status(500).json({ error: 'Failed to fetch database' });
    }
});

// Initialize and start server
(async () => {
    try {
        await firebaseService.initializeDatabase();
        console.log('✅ Database initialized');
    } catch (error) {
        console.error('⚠️  Database initialization error:', error);
        console.log('⚠️  Make sure Firebase is properly configured');
    }
})();

app.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   🌍 GreenGoals Server Running!                           ║
    ║                                                           ║
    ║   Main App:    http://localhost:${PORT}                      ║
    ║   Home:        http://localhost:${PORT}/home.html            ║
    ║   Challenges:  http://localhost:${PORT}/challenges.html      ║
    ║   Leaderboard: http://localhost:${PORT}/leaderboard.html     ║
    ║   Profile:     http://localhost:${PORT}/profile.html         ║
    ║   Admin:       http://localhost:${PORT}/admin.html           ║
    ║                                                           ║
    ║   API Endpoints:                                          ║
    ║   - POST /api/register                                    ║
    ║   - POST /api/login                                       ║
    ║   - GET  /api/challenges                                  ║
    ║   - POST /api/challenges/:id/accept                       ║
    ║   - POST /api/challenges/:id/submit-evidence              ║
    ║   - GET  /api/leaderboard                                 ║
    ║   - GET  /api/stats                                       ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
    `);
});
