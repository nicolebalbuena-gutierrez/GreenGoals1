require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const {OpenAI} = require('openai');

// Import Firebase service module
const firebaseService = require('./firebase-service');
const { generateAICampaignChallenges, isNotPhotoVerifiable } = require('./generate-ai-challenges');
const { moderateChatText } = require('./chat-moderation');

/** Hide legacy or bad challenges that cannot be proven with a photo (still kept in DB for history). */
function filterPublicChallenges(challenges) {
    return challenges.filter(
        (c) =>
            c.aiApprovalStatus !== 'pending_admin' &&
            !isNotPhotoVerifiable(String(c.name || ''), String(c.description || ''))
    );
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
// Replit and many hosts require binding to all interfaces (not only 127.0.0.1).
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-change-me';
if (JWT_SECRET === 'dev-insecure-change-me') {
    console.warn('⚠️  JWT_SECRET is not set. Using an insecure dev default. Set JWT_SECRET in your environment for production.');
}

// OpenAI API Key (from .env or fallback placeholder)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY_HERE';

// News: prefer Gemini (curated JSON). Legacy NewsAPI optional if GEMINI_API_KEY is unset.
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_NEWS_MODEL = process.env.GEMINI_NEWS_MODEL || 'gemini-2.5-flash-lite';
if (!GEMINI_API_KEY && !NEWS_API_KEY) {
    console.warn(
        'ℹ️  /api/news: set GEMINI_API_KEY (recommended) or legacy NEWS_API_KEY in .env — otherwise news will fail.'
    );
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for image uploads
// Disable caching for HTML so users always get the latest version (no stale flash)
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
        }
    }
}));

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
                isAdmin: user.role === 'super_admin',
                surveyCompleted: user.surveyCompleted === true
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
            joinedAt: new Date().toISOString(),
            surveyCompleted: false
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
                isAdmin: false,
                surveyCompleted: false
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
        const raw = String(req.body.username || req.body.email || '').trim();
        const { password } = req.body;
        if (!raw || !password) {
            return res.status(400).json({ error: 'Username/email and password required' });
        }

        let user = null;
        if (raw.includes('@')) {
            user = await firebaseService.getUserByEmail(raw);
        } else {
            user = await firebaseService.getUserByUsername(raw);
            if (!user) {
                const allUsers = await firebaseService.getAllUsers();
                const lower = raw.toLowerCase();
                user = allUsers.find(u => u.username && String(u.username).toLowerCase() === lower) || null;
            }
        }
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
                teamIds: buildUserTeamIds(u),
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

// Get user's evidence history (approved + rejected) for profile
app.get('/api/user/evidence-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const allEvidence = await firebaseService.getEvidenceByUserId(userId);
        const history = allEvidence.filter(e => e.status === 'approved' || e.status === 'rejected');
        history.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
        res.json(history);
    } catch (error) {
        console.error('Error fetching evidence history:', error);
        res.status(500).json({ error: 'Failed to fetch evidence history' });
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
            teamIds: buildUserTeamIds(user),
            isAdmin: user.role === 'super_admin'
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

// Get current user's pending team join request team IDs (for UI "Request sent" state)
app.get('/api/user/team-join-requests', authenticateToken, async (req, res) => {
    try {
        const teamIds = await firebaseService.getUserPendingTeamJoinRequestTeamIds(req.user.userId);
        res.json({ teamIds });
    } catch (error) {
        console.error('Error fetching user team join requests:', error);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// Pending team member invitations (someone invited you to join their team)
app.get('/api/user/team-member-invites', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const invites = await firebaseService.getPendingTeamMemberInvitesForInvitee(userId);
        const teams = await firebaseService.getAllTeams();
        const users = await firebaseService.getAllUsers();
        const enriched = invites.map((inv) => {
            const team = teams.find((t) => t.id === inv.teamId);
            const inviter = users.find((u) => u.id === inv.inviterUserId);
            return {
                id: inv.id,
                teamId: inv.teamId,
                teamName: team ? team.name : 'Team',
                inviterUsername: inviter ? inviter.username : '',
                inviterDisplayName:
                    inviter && (inviter.firstName || inviter.lastName)
                        ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim()
                        : inviter
                          ? inviter.username
                          : 'Someone',
                createdAt: inv.createdAt
            };
        });
        res.json(enriched);
    } catch (error) {
        console.error('Error fetching team member invites:', error);
        res.status(500).json({ error: 'Failed to fetch invitations' });
    }
});

// Follow a user
app.post('/api/user/:id/follow', authenticateToken, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = parseInt(req.params.id);
        if (!followingId || Number.isNaN(followingId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        const targetUser = await firebaseService.getUserById(followingId);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (followerId === followingId) {
            return res.status(400).json({ error: 'Cannot follow yourself' });
        }
        const result = await firebaseService.followUser(followerId, followingId);
        res.json({ message: result.alreadyFollowing ? 'Already following' : 'Following!', following: true });
    } catch (error) {
        console.error('Error following user:', error);
        res.status(500).json({ error: 'Failed to follow user' });
    }
});

// Unfollow a user
app.delete('/api/user/:id/follow', authenticateToken, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = parseInt(req.params.id);
        if (!followingId || Number.isNaN(followingId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        await firebaseService.unfollowUser(followerId, followingId);
        res.json({ message: 'Unfollowed', following: false });
    } catch (error) {
        console.error('Error unfollowing user:', error);
        res.status(500).json({ error: 'Failed to unfollow user' });
    }
});

// Save onboarding survey preferences
app.put('/api/user/survey', authenticateToken, async (req, res) => {
    try {
        const { categories, types, timeCommitment, difficulty } = req.body;
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const surveyPreferences = {
            categories: Array.isArray(categories) ? categories : [],
            types: Array.isArray(types) ? types : [],
            timeCommitment: timeCommitment || 'mix',
            difficulty: difficulty || 'Mix'
        };

        await firebaseService.updateUser(userId, {
            surveyCompleted: true,
            surveyPreferences
        });

        const updatedUser = await firebaseService.getUserById(userId);
        res.json({
            message: 'Survey saved',
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                surveyCompleted: true,
                surveyPreferences: updatedUser.surveyPreferences
            }
        });
    } catch (error) {
        console.error('Error saving survey:', error);
        res.status(500).json({ error: 'Failed to save survey' });
    }
});

// Get user by ID
app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const user = await firebaseService.getUserById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const allChallenges = await firebaseService.getAllChallenges();
        const activeChallenges = (user.activeChallenges || []).map(cId =>
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        const completedChallenges = (user.completedChallenges || []).map(cId =>
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);

        const [followersCount, followingCount] = await Promise.all([
            firebaseService.getFollowersCount(userId),
            firebaseService.getFollowingCount(userId)
        ]);

        const payload = {
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
            teamIds: buildUserTeamIds(user),
            followersCount,
            followingCount,
            surveyCompleted: user.surveyCompleted === true,
            surveyPreferences: user.surveyPreferences || null
        };

        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                payload.isFollowing = await firebaseService.isFollowing(decoded.userId, userId);
            } catch (_) { payload.isFollowing = false; }
        } else {
            payload.isFollowing = false;
        }

        res.json(payload);
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

// Send message/post to general chat (supports text and/or image; optional parentMessageId for replies)
app.post('/api/chat/general', authenticateToken, async (req, res) => {
    try {
        const { text, imageBase64, imageMimeType, parentMessageId } = req.body;
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const hasText = text && String(text).trim();
        const hasImage = imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 0;
        if (!hasText && !hasImage) return res.status(400).json({ error: 'Message text or image required' });
        // Replies: text only, no image
        const isReply = parentMessageId && String(parentMessageId).trim();
        const finalImage = isReply ? null : imageBase64;
        const finalMime = isReply ? null : imageMimeType;

        if (hasText) {
            const mod = await moderateChatText(String(text));
            if (!mod.allowed) {
                console.warn('[chat moderation] Blocked general message', { userId, categories: mod.categories });
                return res.status(400).json({ error: mod.userMessage, code: 'moderation_blocked' });
            }
        }

        const message = await firebaseService.createMessage('general', userId, user.username, text || '', null, finalImage, finalMime || 'image/jpeg', isReply ? parentMessageId : null);
        res.json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Toggle like on a general-chat message
app.post('/api/chat/messages/:id/like', authenticateToken, async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = parseInt(req.user.userId);
        const message = await firebaseService.getMessageById(messageId);
        if (!message) return res.status(404).json({ error: 'Message not found' });
        if ((message.conversationId || '') !== 'general') {
            return res.status(403).json({ error: 'Can only like posts in General Chat' });
        }
        const likedBy = Array.isArray(message.likedBy) ? message.likedBy.map(id => parseInt(id)) : [];
        const idx = likedBy.indexOf(userId);
        if (idx === -1) likedBy.push(userId);
        else likedBy.splice(idx, 1);
        const updated = await firebaseService.updateMessage(messageId, { likedBy });
        res.json({ likedBy: updated.likedBy || [], liked: idx === -1 });
    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: 'Failed to update like' });
    }
});

// Team chat: get list of teams the current user belongs to
app.get('/api/chat/team/list', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);
        if (!teamIds.length) {
            return res.status(400).json({ error: 'You are not in any teams yet' });
        }
        const allTeams = await firebaseService.getAllTeams();
        const teams = allTeams.filter(t => teamIds.includes(t.id));
        res.json(teams);
    } catch (error) {
        console.error('Error fetching user teams for chat:', error);
        res.status(500).json({ error: 'Failed to fetch user teams' });
    }
});

// Team chat: get messages for a specific team the user belongs to
app.get('/api/chat/team', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);
        if (!teamIds.length) {
            return res.status(400).json({ error: 'You are not in a team yet' });
        }

        const requestedTeamId = req.query.teamId ? parseInt(req.query.teamId) : null;
        const teamIdToUse = requestedTeamId && !Number.isNaN(requestedTeamId)
            ? requestedTeamId
            : teamIds[0];

        if (!userHasTeam(user, teamIdToUse)) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const convId = `team_${teamIdToUse}`;
        const messages = await firebaseService.getMessagesByConversation(convId);
        res.json(messages);
    } catch (error) {
        console.error('Error fetching team chat:', error);
        res.status(500).json({ error: 'Failed to fetch team messages' });
    }
});

// Team chat: send message to a specific team the user belongs to
app.post('/api/chat/team', authenticateToken, async (req, res) => {
    try {
        const { text, teamId } = req.body;
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);

        if (!teamIds.length) {
            return res.status(400).json({ error: 'You must be in a team to use team chat' });
        }
        if (!text || !String(text).trim()) {
            return res.status(400).json({ error: 'Message text required' });
        }

        const modTeam = await moderateChatText(String(text));
        if (!modTeam.allowed) {
            console.warn('[chat moderation] Blocked team message', { userId, categories: modTeam.categories });
            return res.status(400).json({ error: modTeam.userMessage, code: 'moderation_blocked' });
        }

        const requestedTeamId = teamId ? parseInt(teamId) : null;
        const teamIdToUse = requestedTeamId && !Number.isNaN(requestedTeamId)
            ? requestedTeamId
            : teamIds[0];

        if (!userHasTeam(user, teamIdToUse)) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const convId = `team_${teamIdToUse}`;
        const message = await firebaseService.createMessage(convId, userId, user.username, text);
        res.json(message);
    } catch (error) {
        console.error('Error sending team message:', error);
        res.status(500).json({ error: 'Failed to send team message' });
    }
});

// Team chat: get team info and members for a specific team the user belongs to
app.get('/api/chat/team/meta', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);
        if (!teamIds.length) {
            return res.status(400).json({ error: 'You are not in a team yet' });
        }

        const requestedTeamId = req.query.teamId ? parseInt(req.query.teamId) : null;
        const teamIdToUse = requestedTeamId && !Number.isNaN(requestedTeamId)
            ? requestedTeamId
            : teamIds[0];

        if (!userHasTeam(user, teamIdToUse)) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const team = await firebaseService.getTeamById(teamIdToUse);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        const allUsers = await firebaseService.getAllUsers();
        const members = allUsers
            .filter(u => userHasTeam(u, team.id))
            .map(u => ({
                id: u.id,
                username: u.username,
                firstName: u.firstName || '',
                lastName: u.lastName || ''
            }));
        res.json({ team, members });
    } catch (error) {
        console.error('Error fetching team meta:', error);
        res.status(500).json({ error: 'Failed to fetch team info' });
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

// DM inbox — MUST be registered before /api/chat/dm/:otherUserId or "partners" is treated as a user id.
app.get('/api/chat/dm/partners', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const partners = await firebaseService.getDmPartnersList(userId);
        res.json(partners);
    } catch (error) {
        console.error('Error fetching DM partners:', error);
        res.status(500).json({ error: 'Failed to load conversations' });
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

        const modDm = await moderateChatText(String(text));
        if (!modDm.allowed) {
            console.warn('[chat moderation] Blocked DM', { userId, recipientId: otherUserId, categories: modDm.categories });
            return res.status(400).json({ error: modDm.userMessage, code: 'moderation_blocked' });
        }

        const convId = firebaseService.getDmConversationId(userId, otherUserId);
        const message = await firebaseService.createMessage(convId, userId, user.username, text, otherUserId);
        res.json(message);
    } catch (error) {
        console.error('Error sending DM:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Search users to start a new DM — requires ?q= (non-empty); never returns the full directory
app.get('/api/chat/users', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const q = (req.query.q || '').trim().toLowerCase();
        if (!q) {
            return res.json([]);
        }
        const allUsers = await firebaseService.getAllUsers();
        const matches = allUsers
            .filter(u => u.id !== userId && u.role !== 'super_admin')
            .filter(u => {
                const uu = (u.username || '').toLowerCase();
                const fn = (u.firstName || '').toLowerCase();
                const ln = (u.lastName || '').toLowerCase();
                const full = (`${fn} ${ln}`).trim();
                return uu.includes(q) || fn.includes(q) || ln.includes(q) || full.includes(q);
            })
            .slice(0, 25)
            .map(u => ({
                id: u.id,
                username: u.username,
                firstName: u.firstName || '',
                lastName: u.lastName || ''
            }));
        matches.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
        res.json(matches);
    } catch (error) {
        console.error('Error searching chat users:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

// Unread message counts since last read (general, per-DM partner, per-team)
app.get('/api/chat/unread', authenticateToken, async (req, res) => {
    try {
        const summary = await firebaseService.getChatUnreadSummary(req.user.userId);
        res.json(summary);
    } catch (error) {
        console.error('Error fetching chat unread:', error);
        res.status(500).json({ error: 'Failed to fetch unread counts' });
    }
});

// Mark a channel as read up to now (updates Firestore chatLastRead)
app.post('/api/chat/read', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { channel, otherUserId, teamId } = req.body || {};

        if (channel === 'general') {
            await firebaseService.markChatLastRead(userId, 'general', {});
            return res.json({ ok: true });
        }
        if (channel === 'dm') {
            const oid = otherUserId != null ? parseInt(otherUserId, 10) : NaN;
            if (Number.isNaN(oid)) {
                return res.status(400).json({ error: 'otherUserId required for dm' });
            }
            const other = await firebaseService.getUserById(oid);
            if (!other) return res.status(404).json({ error: 'User not found' });
            await firebaseService.markChatLastRead(userId, 'dm', { otherUserId: oid });
            return res.json({ ok: true });
        }
        if (channel === 'team') {
            const tid = teamId != null ? parseInt(teamId, 10) : NaN;
            if (Number.isNaN(tid)) {
                return res.status(400).json({ error: 'teamId required for team' });
            }
            const user = await firebaseService.getUserById(userId);
            if (!user) return res.status(404).json({ error: 'User not found' });
            if (!userHasTeam(user, tid)) {
                return res.status(403).json({ error: 'You are not a member of this team' });
            }
            await firebaseService.markChatLastRead(userId, 'team', { teamId: tid });
            return res.json({ ok: true });
        }
        return res.status(400).json({ error: 'Invalid channel (general, dm, or team)' });
    } catch (error) {
        console.error('Error marking chat read:', error);
        res.status(500).json({ error: 'Failed to update read state' });
    }
});

// ============================================
// CHALLENGE ROUTES
// ============================================

// Get all challenges (no-cache so users always see admin-added challenges)
app.get('/api/challenges', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const challenges = filterPublicChallenges(await firebaseService.getAllChallenges());
        res.json(challenges);
    } catch (error) {
        console.error('Error fetching challenges:', error);
        res.status(500).json({ error: 'Failed to fetch challenges' });
    }
});

// User: Suggest/add a new challenge (non-admin) — OpenAI approves, cleans, and enriches
app.post('/api/challenges/custom', authenticateToken, async (req, res) => {
    try {
        const { name, description, points, category, difficulty, duration, co2Saved } = req.body;
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!name || !description) {
            return res.status(400).json({ error: 'Name and description are required' });
        }

        const rawName = String(name).trim();
        const rawDesc = String(description).trim();
        const validCategories = ['Reduce', 'Nature', 'Transport', 'Food', 'Energy'];
        const validDifficulties = ['Easy', 'Medium', 'Hard'];
        const userCategory = category && validCategories.includes(category) ? category : null;
        const userDifficulty = difficulty && validDifficulties.includes(difficulty) ? difficulty : null;
        const userDuration = duration ? String(duration).trim() : null;
        const userPoints = points ? parseInt(points) : null;
        const userCO2 = co2Saved ? parseFloat(co2Saved) : null;

        const hasOpenAI =
            OPENAI_API_KEY &&
            OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY_HERE';

        let cleanedDescription = rawDesc;
        let suggestedCategory = userCategory || 'Reduce';
        let suggestedDifficulty = userDifficulty || 'Easy';
        let suggestedDuration = userDuration || '1 day';
        let suggestedCO2 = userCO2 ?? 1;
        let suggestedPoints = userPoints ?? 25;
        let approved = true;

        if (hasOpenAI) {
            try {
                const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        response_format: { type: 'json_object' },
                        messages: [
                            {
                                role: 'system',
                                content: `You are an eco-challenge moderator for GreenGoals (college students). Users prove completion by uploading ONE photo that must reasonably match the challenge. Review user-submitted challenges and:
1. APPROVE or REJECT: Approve if it's valid, eco-friendly, and **photo-verifiable** (reviewer can tell from a picture). Reject if it's spam, inappropriate, not eco-related, too vague, or **cannot be proven with a photo** (e.g. "take shorter showers", "always unplug", honor-system-only habits). Reject if it needs private land or major resources (e.g. plant a full tree in a yard, install home solar, buy an EV). If approved, ensure the cleaned description hints what kind of photo counts (e.g. "Photo: your reusable mug at the dining hall").
2. If approved: clean the description (fix grammar, improve clarity, make it action-oriented).
3. If approved: pick the best category from exactly: Reduce, Nature, Transport, Food, Energy.
4. If approved: pick difficulty: Easy, Medium, or Hard based on effort and commitment required.
5. If approved: suggest duration (e.g. "1 day", "1 week", "3 days") based on the challenge.
6. If approved: estimate kg CO2 saved (typical range 0.5–50 kg depending on the action).
7. If approved: suggest points (15–100 based on difficulty and impact: Easy 15–30, Medium 30–60, Hard 60–100).
Respond ONLY as JSON with: approved (boolean), rejectionReason (string, only if rejected), cleanedDescription (string), suggestedCategory (one of: Reduce, Nature, Transport, Food, Energy), suggestedDifficulty (Easy, Medium, or Hard), suggestedDuration (string), suggestedCO2 (number), suggestedPoints (number).`
                            },
                            {
                                role: 'user',
                                content: `Challenge name: "${rawName}"\nDescription: "${rawDesc}"`
                            }
                        ]
                    })
                });

                if (aiRes.ok) {
                    const aiJson = await aiRes.json();
                    const content = aiJson.choices?.[0]?.message?.content || '{}';
                    try {
                        const parsed = JSON.parse(content);
                        approved = !!parsed.approved;
                        if (!approved && parsed.rejectionReason) {
                            return res.status(400).json({
                                error: 'Challenge not approved',
                                reason: parsed.rejectionReason
                            });
                        }
                        if (approved) {
                            cleanedDescription = parsed.cleanedDescription || rawDesc;
                            suggestedCategory = validCategories.includes(parsed.suggestedCategory) ? parsed.suggestedCategory : (userCategory || 'Reduce');
                            suggestedDifficulty = validDifficulties.includes(parsed.suggestedDifficulty) ? parsed.suggestedDifficulty : (userDifficulty || 'Easy');
                            suggestedDuration = parsed.suggestedDuration || userDuration || '1 day';
                            suggestedCO2 = typeof parsed.suggestedCO2 === 'number' ? parsed.suggestedCO2 : (userCO2 ?? 1);
                            suggestedPoints = typeof parsed.suggestedPoints === 'number' ? parsed.suggestedPoints : (userPoints ?? 25);
                        }
                    } catch (e) {
                        console.error('Failed to parse OpenAI challenge JSON:', e);
                    }
                } else {
                    console.error('OpenAI challenge review error:', aiRes.status);
                }
            } catch (aiError) {
                console.error('Error calling OpenAI for challenge:', aiError);
            }
        }

        const newChallenge = {
            name: rawName,
            description: cleanedDescription,
            points: suggestedPoints,
            category: suggestedCategory,
            difficulty: suggestedDifficulty,
            duration: suggestedDuration,
            co2Saved: suggestedCO2,
            userCreated: true,
            createdByUserId: user.id,
            createdByUsername: user.username || '',
            createdAt: new Date().toISOString(),
            aiApprovalStatus: 'live'
        };

        const createdChallenge = await firebaseService.createChallenge(newChallenge);
        res.json({
            message: 'Challenge created!',
            challenge: createdChallenge,
            aiEnriched: hasOpenAI && approved
        });
    } catch (error) {
        console.error('Error creating user challenge:', error);
        res.status(500).json({ error: 'Failed to create challenge' });
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

        // Keep pending evidence saved for admin review; user can re-upload new evidence if they re-accept

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

// Submit evidence for a challenge (uses OpenAI for auto-review when configured)
app.post('/api/challenges/:id/submit-evidence', authenticateToken, async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        const challengeId = parseInt(req.params.id);
        const userId = req.user.userId;

        let user = await firebaseService.getUserById(userId);
        const challenge = await firebaseService.getChallengeById(challengeId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }

        let activeIds = (user.activeChallenges || []).map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
        if (!activeIds.includes(challengeId)) {
            const usersWithChallenge = await firebaseService.getUsersWithChallengeInActive(challengeId);
            const matchingUser = usersWithChallenge.find(u => parseInt(u.id) === parseInt(userId));
            if (matchingUser) {
                user = matchingUser;
                activeIds = (user.activeChallenges || []).map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
            } else {
                return res.status(400).json({ error: 'Challenge not in progress. Accept the challenge first from the Challenges page.' });
            }
        }

        if (!imageBase64) {
            return res.status(400).json({ error: 'Please provide an image' });
        }

        // If OpenAI key is not configured, fall back to legacy "pending admin review" flow
        const hasOpenAI =
            OPENAI_API_KEY &&
            OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY_HERE';

        if (!hasOpenAI) {
            // Delete any existing pending evidence so user can replace (e.g. after abandon + re-accept)
            const userEvidence = await firebaseService.getEvidenceByUserId(userId);
            const existingPending = userEvidence.filter(
                e => (e.challengeId === challengeId || e.challengeId == challengeId) && e.status === 'pending'
            );
            for (const ev of existingPending) {
                await firebaseService.deleteEvidence(ev.id);
            }

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
                status: 'pending',
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
        }

        // ===============================
        // OpenAI auto-review path
        // ===============================

        let aiApproved = false;
        let aiReason = 'No explanation';
        let aiConfidence = 0;

        try {
            const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4.1-mini',
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an eco-challenge evidence reviewer. The challenge description often says what photo is expected. Given the description and the user\'s photo, decide if the image reasonably proves they completed the challenge (object, setting, or action visible). Reject stock/random unrelated images. Respond ONLY as JSON: approved (boolean), reason (string), confidence (0–1). Be strict but fair.'
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: `Challenge: ${challenge.name}\nDescription: ${challenge.description || ''}\n\nDoes this photo clearly show the user has completed this challenge?`
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/jpeg;base64,${imageBase64}`
                                    }
                                }
                            ]
                        }
                    ]
                })
            });

            if (!aiRes.ok) {
                console.error('OpenAI error status:', aiRes.status);
            } else {
                const aiJson = await aiRes.json();
                const content = aiJson.choices?.[0]?.message?.content || '{}';
                try {
                    const parsed = JSON.parse(content);
                    aiApproved = !!parsed.approved;
                    aiReason = parsed.reason || aiReason;
                    aiConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : aiConfidence;
                } catch (e) {
                    console.error('Failed to parse OpenAI response JSON:', e);
                }
            }
        } catch (aiError) {
            console.error('Error calling OpenAI:', aiError);
        }

        const nowIso = new Date().toISOString();
        const status = aiApproved ? 'approved' : 'rejected';

        // Create evidence record with AI decision
        const evidenceRecord = {
            userId: userId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            challengeId: challengeId,
            challengeName: challenge.name,
            challengePoints: challenge.points,
            challengeCO2: challenge.co2Saved,
            imageBase64: imageBase64,
            status,
            submittedAt: nowIso,
            reviewedAt: nowIso,
            reviewNotes: `${aiReason} (AI auto-review, confidence=${aiConfidence})`
        };

        await firebaseService.createEvidence(evidenceRecord);

        if (aiApproved) {
            // Mark challenge as completed for the user and award points
            const active = Array.isArray(user.activeChallenges) ? user.activeChallenges : [];
            const completed = Array.isArray(user.completedChallenges) ? user.completedChallenges : [];

            const newActive = active.filter(id => id !== challengeId);
            const newCompleted = completed.includes(challengeId)
                ? completed
                : [...completed, challengeId];

            const newPoints = (user.points || 0) + (challenge.points || 0);
            const newCO2 = (user.totalCO2Saved || 0) + (challenge.co2Saved || 0);

            await firebaseService.updateUser(userId, {
                activeChallenges: newActive,
                completedChallenges: newCompleted,
                points: newPoints,
                totalCO2Saved: newCO2
            });

            return res.json({
                approved: true,
                message: `Nice work on "${challenge.name}" – your evidence looks valid!`,
                reason: aiReason,
                pointsEarned: challenge.points || 0
            });
        } else {
            return res.json({
                approved: false,
                message: 'We could not confidently verify this photo as proof for the challenge.',
                reason: aiReason
            });
        }
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

// Admin: Get all evidence (including reviewed) - with images; enrich challenge meta for UI grouping
app.get('/api/admin/all-evidence', authenticateAdmin, async (req, res) => {
    try {
        const allEvidence = await firebaseService.getAllEvidence();
        const challenges = await firebaseService.getAllChallenges();
        const chById = new Map(challenges.map((c) => [Number(c.id), c]));
        const enriched = allEvidence.map((e) => {
            const cid = e.challengeId != null ? Number(e.challengeId) : NaN;
            const ch = Number.isFinite(cid) ? chById.get(cid) : null;
            return {
                ...e,
                challengeName: e.challengeName || (ch && ch.name) || (Number.isFinite(cid) ? `Challenge #${cid}` : 'Unknown challenge'),
                challengeCategory: e.challengeCategory || (ch && ch.category) || '',
                challengePoints: e.challengePoints != null ? e.challengePoints : (ch && ch.points),
                challengeCO2: e.challengeCO2 != null ? e.challengeCO2 : (ch && ch.co2Saved)
            };
        });
        enriched.sort((a, b) => {
            const ta = new Date(a.reviewedAt || a.submittedAt || 0).getTime();
            const tb = new Date(b.reviewedAt || b.submittedAt || 0).getTime();
            return tb - ta;
        });
        res.json(enriched);
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

function userHasTeam(user, teamId) {
    if (!user) return false;
    const tid = parseInt(teamId);
    if (Array.isArray(user.teamIds) && user.teamIds.includes(tid)) return true;
    return parseInt(user.teamId) === tid;
}

function buildUserTeamIds(user) {
    const base = [];
    if (Array.isArray(user.teamIds)) {
        user.teamIds.forEach(id => {
            const n = parseInt(id);
            if (!Number.isNaN(n) && !base.includes(n)) base.push(n);
        });
    } else if (user.teamId) {
        const n = parseInt(user.teamId);
        if (!Number.isNaN(n)) base.push(n);
    }
    return base;
}

async function addUserToTeamMembership(user, teamId) {
    const tid = parseInt(teamId);
    if (Number.isNaN(tid)) return user;
    const teamIds = buildUserTeamIds(user);
    if (!teamIds.includes(tid)) {
        teamIds.push(tid);
    }
    const updates = { teamIds };
    // Preserve existing primary team; if none, set this as primary
    if (!user.teamId) {
        updates.teamId = tid;
    }
    return firebaseService.updateUser(user.id, updates);
}

async function removeUserFromTeamMembership(user, teamId) {
    const tid = parseInt(teamId);
    if (Number.isNaN(tid)) return user;
    const teamIds = buildUserTeamIds(user).filter(id => id !== tid);
    const updates = { teamIds };
    if (parseInt(user.teamId) === tid) {
        updates.teamId = teamIds.length ? teamIds[0] : null;
    }
    return firebaseService.updateUser(user.id, updates);
}

// Get all teams
app.get('/api/teams', async (req, res) => {
    try {
        const teams = await firebaseService.getAllTeams();
        const allUsers = await firebaseService.getAllUsers();
        const teamsWithMembers = teams.map(t => ({
            ...t,
            memberCount: allUsers.filter(u => userHasTeam(u, t.id)).length
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

        const newTeam = {
            name,
            description,
            leaderId: userId,
            totalPoints: user.points || 0,
            createdAt: new Date().toISOString()
        };

        const createdTeam = await firebaseService.createTeam(newTeam);
        const updatedUser = await addUserToTeamMembership(user, createdTeam.id);
        await firebaseService.updateTeam(createdTeam.id, {
            totalPoints: createdTeam.totalPoints || (updatedUser.points || 0)
        });

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

        if (userHasTeam(user, teamId)) {
            return res.status(400).json({ error: 'Already in this team' });
        }

        const updatedUser = await addUserToTeamMembership(user, teamId);
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (updatedUser.points || 0)
        });

        const updatedTeam = await firebaseService.getTeamById(teamId);
        res.json({ message: `Joined team: ${team.name}!`, team: updatedTeam });
    } catch (error) {
        console.error('Error joining team:', error);
        res.status(500).json({ error: 'Failed to join team' });
    }
});

// Request to join a team (creates pending request; team leader approves later)
app.post('/api/teams/:id/request-join', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const team = await firebaseService.getTeamById(teamId);

        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        if (userHasTeam(user, teamId)) {
            return res.status(400).json({ error: 'You are already in this team' });
        }
        const existing = await firebaseService.getTeamJoinRequestByUserAndTeam(userId, teamId);
        if (existing) {
            return res.status(400).json({ error: 'You already have a pending request for this team' });
        }

        const request = await firebaseService.createTeamJoinRequest({
            teamId,
            userId,
            username: user.username || '',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        });
        res.json({ message: 'Request sent! The team leader will review it.', request });
    } catch (error) {
        console.error('Error requesting to join team:', error);
        res.status(500).json({ error: 'Failed to send request' });
    }
});

// Get pending join requests for a team (team leader or member only)
app.get('/api/teams/:id/join-requests', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const team = await firebaseService.getTeamById(teamId);

        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (!userHasTeam(user, teamId)) {
            return res.status(403).json({ error: 'Only team members can view join requests' });
        }

        const requests = await firebaseService.getTeamJoinRequestsByTeamId(teamId);
        res.json(requests);
    } catch (error) {
        console.error('Error fetching join requests:', error);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// Approve a join request (team leader or member)
app.post('/api/teams/:id/join-requests/:requestId/approve', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const requestId = parseInt(req.params.requestId);
        const userId = req.user.userId;
        const requester = await firebaseService.getUserById(userId);
        const team = await firebaseService.getTeamById(teamId);
        const joinRequest = await firebaseService.getTeamJoinRequestById(requestId);

        if (!team || !joinRequest) return res.status(404).json({ error: 'Not found' });
        if (joinRequest.teamId !== teamId || joinRequest.status !== 'pending') {
            return res.status(400).json({ error: 'Invalid request' });
        }
        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'Only team members can approve requests' });
        }

        const userToAdd = await firebaseService.getUserById(joinRequest.userId);
        if (!userToAdd) return res.status(404).json({ error: 'User not found' });
        if (userHasTeam(userToAdd, teamId)) {
            await firebaseService.updateTeamJoinRequest(requestId, { status: 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: userId });
            return res.status(400).json({ error: 'User is already in the team' });
        }

        await addUserToTeamMembership(userToAdd, teamId);
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (userToAdd.points || 0)
        });
        await firebaseService.updateTeamJoinRequest(requestId, {
            status: 'approved',
            reviewedAt: new Date().toISOString(),
            reviewedBy: userId
        });

        res.json({ message: `${userToAdd.firstName || userToAdd.username} has been added to the team!` });
    } catch (error) {
        console.error('Error approving join request:', error);
        res.status(500).json({ error: 'Failed to approve' });
    }
});

// Reject a join request
app.post('/api/teams/:id/join-requests/:requestId/reject', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const requestId = parseInt(req.params.requestId);
        const userId = req.user.userId;
        const requester = await firebaseService.getUserById(userId);
        const joinRequest = await firebaseService.getTeamJoinRequestById(requestId);

        if (!joinRequest) return res.status(404).json({ error: 'Request not found' });
        if (joinRequest.teamId !== teamId || joinRequest.status !== 'pending') {
            return res.status(400).json({ error: 'Invalid request' });
        }
        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'Only team members can reject requests' });
        }

        await firebaseService.updateTeamJoinRequest(requestId, {
            status: 'rejected',
            reviewedAt: new Date().toISOString(),
            reviewedBy: userId
        });
        res.json({ message: 'Join request rejected' });
    } catch (error) {
        console.error('Error rejecting join request:', error);
        res.status(500).json({ error: 'Failed to reject' });
    }
});

// Leave team
app.post('/api/teams/leave', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        const targetTeamId = req.body && req.body.teamId ? parseInt(req.body.teamId) : parseInt(user.teamId);

        if (!targetTeamId || Number.isNaN(targetTeamId)) {
            return res.status(400).json({ error: 'Not in a team' });
        }

        if (!userHasTeam(user, targetTeamId)) {
            return res.status(400).json({ error: 'Not in this team' });
        }

        const team = await firebaseService.getTeamById(targetTeamId);
        if (team) {
            await firebaseService.updateTeam(targetTeamId, {
                totalPoints: Math.max(0, (team.totalPoints || 0) - (user.points || 0))
            });
        }

        await removeUserFromTeamMembership(user, targetTeamId);

        res.json({ message: 'Left team successfully' });
    } catch (error) {
        console.error('Error leaving team:', error);
        res.status(500).json({ error: 'Failed to leave team' });
    }
});

// Invitee accepts a pending team member invitation (invited from Add members)
app.post('/api/user/team-member-invites/:inviteId/accept', authenticateToken, async (req, res) => {
    try {
        const inviteId = parseInt(req.params.inviteId, 10);
        const userId = req.user.userId;
        const invite = await firebaseService.getTeamMemberInviteById(inviteId);
        if (!invite || invite.status !== 'pending' || invite.inviteeUserId !== userId) {
            return res.status(400).json({ error: 'Invalid or expired invitation' });
        }
        const team = await firebaseService.getTeamById(invite.teamId);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        const userToAdd = await firebaseService.getUserById(userId);
        if (userHasTeam(userToAdd, invite.teamId)) {
            await firebaseService.updateTeamMemberInvite(inviteId, {
                status: 'accepted',
                respondedAt: new Date().toISOString()
            });
            return res.json({ message: 'You are already in this team', alreadyMember: true });
        }
        await addUserToTeamMembership(userToAdd, invite.teamId);
        await firebaseService.updateTeam(invite.teamId, {
            totalPoints: (team.totalPoints || 0) + (userToAdd.points || 0)
        });
        await firebaseService.updateTeamMemberInvite(inviteId, {
            status: 'accepted',
            respondedAt: new Date().toISOString()
        });
        const updatedTeam = await firebaseService.getTeamById(invite.teamId);
        res.json({ message: `You joined ${team.name}!`, team: updatedTeam });
    } catch (error) {
        console.error('Error accepting team invite:', error);
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});

app.post('/api/user/team-member-invites/:inviteId/decline', authenticateToken, async (req, res) => {
    try {
        const inviteId = parseInt(req.params.inviteId, 10);
        const userId = req.user.userId;
        const invite = await firebaseService.getTeamMemberInviteById(inviteId);
        if (!invite || invite.status !== 'pending' || invite.inviteeUserId !== userId) {
            return res.status(400).json({ error: 'Invalid invitation' });
        }
        await firebaseService.updateTeamMemberInvite(inviteId, {
            status: 'declined',
            respondedAt: new Date().toISOString()
        });
        res.json({ message: 'Invitation declined' });
    } catch (error) {
        console.error('Error declining team invite:', error);
        res.status(500).json({ error: 'Failed to decline invitation' });
    }
});

app.get('/api/teams/:id/member-invites/pending', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id, 10);
        const requester = await firebaseService.getUserById(req.user.userId);
        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'Must be a team member' });
        }
        const list = await firebaseService.getPendingTeamMemberInvitesForTeam(teamId);
        res.json(
            list.map((inv) => ({ id: inv.id, inviteeUserId: inv.inviteeUserId, createdAt: inv.createdAt }))
        );
    } catch (error) {
        console.error('Error fetching pending member invites:', error);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// Invite a user to join the team (they accept or decline under Team requests)
app.post('/api/teams/:id/add-member', authenticateToken, async (req, res) => {
    try {
        const { userId: inviteeBodyId } = req.body;
        const teamId = parseInt(req.params.id, 10);
        const requesterId = req.user.userId;

        const requester = await firebaseService.getUserById(requesterId);
        const team = await firebaseService.getTeamById(teamId);
        const inviteeNumeric = parseInt(inviteeBodyId, 10);
        const userToInvite = await firebaseService.getUserById(inviteeNumeric);

        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        if (!userToInvite || Number.isNaN(inviteeNumeric)) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'You must be a team member to invite others' });
        }

        if (inviteeNumeric === requesterId) {
            return res.status(400).json({ error: 'You cannot invite yourself' });
        }

        if (userHasTeam(userToInvite, teamId)) {
            return res.status(400).json({ error: 'User is already in this team' });
        }

        const existingInvite = await firebaseService.getPendingTeamMemberInviteByTeamAndInvitee(teamId, inviteeNumeric);
        if (existingInvite) {
            return res.status(400).json({ error: 'An invitation is already pending for this user' });
        }

        const existingJoin = await firebaseService.getTeamJoinRequestByUserAndTeam(inviteeNumeric, teamId);
        if (existingJoin) {
            return res.status(400).json({
                error: 'This user already requested to join. Approve their request in Join requests instead.'
            });
        }

        const invite = await firebaseService.createTeamMemberInvite({
            teamId,
            inviterUserId: requesterId,
            inviteeUserId: inviteeNumeric,
            teamName: team.name || '',
            inviterUsername: requester.username || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        res.json({
            message: `Invitation sent to ${userToInvite.firstName || userToInvite.username}. They can accept it under Team requests on the Teams page.`,
            invite
        });
    } catch (error) {
        console.error('Error inviting team member:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
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
                memberCount: allUsers.filter(u => userHasTeam(u, t.id)).length
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
        const liveChallenges = challenges.filter((c) => c.aiApprovalStatus !== 'pending_admin');
        const totalChallenges = liveChallenges.length;

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
            co2Saved: parseFloat(co2Saved),
            aiApprovalStatus: 'live'
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

// Admin: Publish AI draft (approve for users) — optional body fields override before going live
app.post('/api/admin/challenges/:id/publish-ai', authenticateAdmin, async (req, res) => {
    try {
        const challengeId = parseInt(req.params.id, 10);
        if (Number.isNaN(challengeId)) {
            return res.status(400).json({ error: 'Invalid challenge id' });
        }
        const challenge = await firebaseService.getChallengeById(challengeId);
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }
        if (challenge.aiApprovalStatus !== 'pending_admin') {
            return res.status(400).json({ error: 'Challenge is not awaiting AI review' });
        }
        const body = req.body || {};
        const updates = { aiApprovalStatus: 'live' };
        if (body.name != null && String(body.name).trim()) updates.name = String(body.name).trim();
        if (body.description != null) updates.description = String(body.description).trim();
        if (body.category != null && String(body.category).trim()) updates.category = String(body.category).trim();
        if (body.difficulty != null && String(body.difficulty).trim()) updates.difficulty = String(body.difficulty).trim();
        if (body.duration != null && String(body.duration).trim()) updates.duration = String(body.duration).trim();
        if (body.cadence != null && String(body.cadence).trim()) updates.cadence = String(body.cadence).trim();
        if (body.points != null && body.points !== '') {
            const p = parseInt(body.points, 10);
            if (!Number.isNaN(p)) updates.points = p;
        }
        if (body.co2Saved != null && body.co2Saved !== '') {
            const co2 = parseFloat(body.co2Saved);
            if (!Number.isNaN(co2)) updates.co2Saved = co2;
        }
        await firebaseService.updateChallenge(challengeId, updates);
        const updated = await firebaseService.getChallengeById(challengeId);
        res.json({ message: 'Challenge published', challenge: updated });
    } catch (error) {
        console.error('Error publishing AI challenge:', error);
        res.status(500).json({ error: 'Failed to publish challenge' });
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
            const leader = t.leaderId != null ? await firebaseService.getUserById(t.leaderId) : null;
            const members = allUsers
                .filter(u => userHasTeam(u, t.id))
                .map(u => ({
                    id: u.id,
                    firstName: u.firstName || '',
                    lastName: u.lastName || '',
                    username: u.username
                }));

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

        // Remove this team from all members' memberships
        const allUsers = await firebaseService.getAllUsers();
        const teamMembers = allUsers.filter(u => userHasTeam(u, teamId));

        await Promise.all(teamMembers.map(user =>
            removeUserFromTeamMembership(user, teamId)
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

        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Can't remove the leader from their own team
        if (team.leaderId === userId) {
            return res.status(400).json({ error: 'Cannot remove team leader. Delete the team instead.' });
        }

        if (!userHasTeam(user, teamId)) {
            return res.status(400).json({ error: 'User is not a member of this team' });
        }

        await removeUserFromTeamMembership(user, teamId);

        res.json({ message: 'Member removed from team!' });
    } catch (error) {
        console.error('Error removing team member:', error);
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});

// Admin: Add member to team
app.post('/api/admin/teams/:id/add-member', authenticateAdmin, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const { userId, username } = req.body || {};

        const team = await firebaseService.getTeamById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        let user = null;
        if (userId) {
            user = await firebaseService.getUserById(parseInt(userId));
        } else if (username) {
            user = await firebaseService.getUserByUsername(String(username).trim());
        } else {
            return res.status(400).json({ error: 'userId or username is required' });
        }

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.role === 'super_admin' || user.role === 'admin') {
            return res.status(400).json({ error: 'Cannot add admin users to teams' });
        }

        if (user.teamId) {
            if (parseInt(user.teamId) === teamId) {
                return res.status(400).json({ error: 'User is already in this team' });
            }
            return res.status(400).json({ error: 'User is already in another team' });
        }

        await firebaseService.updateUser(user.id, { teamId });
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (user.points || 0)
        });

        const updatedTeam = await firebaseService.getTeamById(teamId);

        res.json({
            message: `${user.firstName || user.username} has been added to ${team.name}!`,
            team: updatedTeam
        });
    } catch (error) {
        console.error('Error adding team member (admin):', error);
        res.status(500).json({ error: 'Failed to add team member' });
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
// NEWS (Gemini or legacy NewsAPI)
// ============================================

function parseJsonFromGeminiText(text) {
    if (text == null) return null;
    let t = String(text).trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
    if (fence) t = fence[1].trim();
    return JSON.parse(t);
}

async function fetchNewsViaNewsApi() {
    const searchTerms =
        '("climate change" OR "global warming" OR "renewable energy" OR "carbon footprint" OR "electric vehicle" OR "solar energy" OR "wind power" OR "sustainability" OR "zero emissions")';
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchTerms)}&sortBy=relevancy&pageSize=12&language=en&apiKey=${NEWS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'error') {
        throw new Error(data.message || 'NewsAPI error');
    }

    const relevantKeywords = [
        'climate',
        'environment',
        'sustainable',
        'renewable',
        'solar',
        'wind',
        'carbon',
        'emission',
        'electric vehicle',
        'ev',
        'green',
        'eco',
        'recycle',
        'pollution',
        'energy',
    ];

    return data.articles
        .filter((article) => {
            const text = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
            return relevantKeywords.some((keyword) => text.includes(keyword));
        })
        .slice(0, 6)
        .map((article) => ({
            title: article.title,
            description: article.description,
            url: article.url,
            image: article.urlToImage,
            source: article.source.name,
            publishedAt: article.publishedAt,
        }));
}

async function fetchNewsViaGemini() {
    const model = GEMINI_NEWS_MODEL;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
    )}:generateContent`;
    const url = `${endpoint}?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const prompt = `You curate recent English-language climate and sustainability news for a college eco app.

Return ONLY valid JSON (no markdown, no commentary): an array of exactly 8 objects. Each object must have:
- title: string (<= 120 characters)
- description: string (1–2 sentences, <= 260 characters), neutral factual tone
- url: string starting with https — prefer a direct article URL from a reputable outlet when you are confident it is valid; otherwise use a Google News search URL like https://news.google.com/search?q= plus a properly URL-encoded query for that story angle
- source: string (publisher name, or "Google News" when the url is a Google News search)
- image: string — direct https image URL if known, otherwise ""

Cover varied topics among: climate policy and science, renewable energy, electrification and transport, nature and conservation, corporate climate or ESG, sustainable food/agriculture, oceans/plastics.

Do not repeat the same story; diversify outlets/topics when possible.`;

    const baseBody = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.35,
            topP: 0.9,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
        },
    };

    const withSearch = {
        ...baseBody,
        tools: [{ googleSearch: {} }],
    };

    const doRequest = async (bodyObj) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj),
        });
        const raw = await res.text();
        let data = null;
        try {
            data = JSON.parse(raw);
        } catch {
            // non-JSON body
        }
        return { ok: res.ok, status: res.status, raw, data };
    };

    let out = await doRequest(withSearch);
    if (!out.ok) {
        console.warn(
            'Gemini news (googleSearch tool) failed:',
            out.status,
            (out.raw || '').slice(0, 400)
        );
        out = await doRequest(baseBody);
    }
    if (!out.ok) {
        const msg =
            out.data?.error?.message || (out.raw || '').slice(0, 700) || `HTTP ${out.status}`;
        throw new Error(msg);
    }

    const data = out.data;
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) {
        throw new Error(`Gemini blocked prompt: ${blockReason}`);
    }

    const parts = data?.candidates?.[0]?.content?.parts;
    const rawText = Array.isArray(parts) ? parts.map((p) => p.text).join('') : '';
    if (!String(rawText).trim()) {
        throw new Error('Gemini returned empty news content');
    }

    let parsed;
    try {
        parsed = parseJsonFromGeminiText(rawText);
    } catch (e) {
        throw new Error(`Gemini news JSON parse failed: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error('Gemini news response was not a JSON array');
    }

    const normalized = parsed
        .map((a) => ({
            title: String(a.title || '').trim(),
            description: String(a.description || '').trim(),
            url: String(a.url || '').trim(),
            image: String(a.image || '').trim(),
            source: String(a.source || '').trim() || 'News',
            publishedAt: a.publishedAt != null ? String(a.publishedAt) : undefined,
        }))
        .filter((a) => a.title && /^https:\/\//i.test(a.url));

    if (normalized.length === 0) {
        throw new Error('Gemini returned no usable news rows (need https urls)');
    }

    return normalized.slice(0, 12);
}

// Get sustainability news (Gemini first, else NewsAPI)
app.get('/api/news', async (req, res) => {
    try {
        if (GEMINI_API_KEY) {
            const articles = await fetchNewsViaGemini();
            return res.json(articles);
        }
        if (NEWS_API_KEY) {
            const articles = await fetchNewsViaNewsApi();
            return res.json(articles);
        }
        return res.status(500).json({
            error: 'Server news is not configured. Set GEMINI_API_KEY (recommended) or NEWS_API_KEY in the server environment.',
        });
    } catch (error) {
        console.error('Error fetching news:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch news' });
    }
});

// ============================================
// DATABASE ROUTES (for debugging)
// ============================================

// Get raw database (super_admin JWT only)
app.get('/api/database/raw', authenticateAdmin, async (req, res) => {
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
                isAdmin: user.role === 'super_admin',
                surveyCompleted: user.surveyCompleted === true
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
            joinedAt: new Date().toISOString(),
            surveyCompleted: false
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
                isAdmin: false,
                surveyCompleted: false
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
        const raw = String(req.body.username || req.body.email || '').trim();
        const { password } = req.body;
        if (!raw || !password) {
            return res.status(400).json({ error: 'Username/email and password required' });
        }

        let user = null;
        if (raw.includes('@')) {
            user = await firebaseService.getUserByEmail(raw);
        } else {
            user = await firebaseService.getUserByUsername(raw);
            if (!user) {
                const allUsers = await firebaseService.getAllUsers();
                const lower = raw.toLowerCase();
                user = allUsers.find(u => u.username && String(u.username).toLowerCase() === lower) || null;
            }
        }
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
                teamIds: buildUserTeamIds(u),
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

// Get user's evidence history (approved + rejected) for profile
app.get('/api/user/evidence-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const allEvidence = await firebaseService.getEvidenceByUserId(userId);
        const history = allEvidence.filter(e => e.status === 'approved' || e.status === 'rejected');
        history.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
        res.json(history);
    } catch (error) {
        console.error('Error fetching evidence history:', error);
        res.status(500).json({ error: 'Failed to fetch evidence history' });
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
            teamIds: buildUserTeamIds(user),
            isAdmin: user.role === 'super_admin'
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

// Get current user's pending team join request team IDs (for UI "Request sent" state)
app.get('/api/user/team-join-requests', authenticateToken, async (req, res) => {
    try {
        const teamIds = await firebaseService.getUserPendingTeamJoinRequestTeamIds(req.user.userId);
        res.json({ teamIds });
    } catch (error) {
        console.error('Error fetching user team join requests:', error);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// Pending team member invitations (someone invited you to join their team)
app.get('/api/user/team-member-invites', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const invites = await firebaseService.getPendingTeamMemberInvitesForInvitee(userId);
        const teams = await firebaseService.getAllTeams();
        const users = await firebaseService.getAllUsers();
        const enriched = invites.map((inv) => {
            const team = teams.find((t) => t.id === inv.teamId);
            const inviter = users.find((u) => u.id === inv.inviterUserId);
            return {
                id: inv.id,
                teamId: inv.teamId,
                teamName: team ? team.name : 'Team',
                inviterUsername: inviter ? inviter.username : '',
                inviterDisplayName:
                    inviter && (inviter.firstName || inviter.lastName)
                        ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim()
                        : inviter
                          ? inviter.username
                          : 'Someone',
                createdAt: inv.createdAt
            };
        });
        res.json(enriched);
    } catch (error) {
        console.error('Error fetching team member invites:', error);
        res.status(500).json({ error: 'Failed to fetch invitations' });
    }
});

// Follow a user
app.post('/api/user/:id/follow', authenticateToken, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = parseInt(req.params.id);
        if (!followingId || Number.isNaN(followingId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        const targetUser = await firebaseService.getUserById(followingId);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (followerId === followingId) {
            return res.status(400).json({ error: 'Cannot follow yourself' });
        }
        const result = await firebaseService.followUser(followerId, followingId);
        res.json({ message: result.alreadyFollowing ? 'Already following' : 'Following!', following: true });
    } catch (error) {
        console.error('Error following user:', error);
        res.status(500).json({ error: 'Failed to follow user' });
    }
});

// Unfollow a user
app.delete('/api/user/:id/follow', authenticateToken, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = parseInt(req.params.id);
        if (!followingId || Number.isNaN(followingId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        await firebaseService.unfollowUser(followerId, followingId);
        res.json({ message: 'Unfollowed', following: false });
    } catch (error) {
        console.error('Error unfollowing user:', error);
        res.status(500).json({ error: 'Failed to unfollow user' });
    }
});

// Save onboarding survey preferences
app.put('/api/user/survey', authenticateToken, async (req, res) => {
    try {
        const { categories, types, timeCommitment, difficulty } = req.body;
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const surveyPreferences = {
            categories: Array.isArray(categories) ? categories : [],
            types: Array.isArray(types) ? types : [],
            timeCommitment: timeCommitment || 'mix',
            difficulty: difficulty || 'Mix'
        };

        await firebaseService.updateUser(userId, {
            surveyCompleted: true,
            surveyPreferences
        });

        const updatedUser = await firebaseService.getUserById(userId);
        res.json({
            message: 'Survey saved',
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                surveyCompleted: true,
                surveyPreferences: updatedUser.surveyPreferences
            }
        });
    } catch (error) {
        console.error('Error saving survey:', error);
        res.status(500).json({ error: 'Failed to save survey' });
    }
});

// Get user by ID
app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const user = await firebaseService.getUserById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const allChallenges = await firebaseService.getAllChallenges();
        const activeChallenges = (user.activeChallenges || []).map(cId =>
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);
        const completedChallenges = (user.completedChallenges || []).map(cId =>
            allChallenges.find(c => c.id === cId)
        ).filter(Boolean);

        const [followersCount, followingCount] = await Promise.all([
            firebaseService.getFollowersCount(userId),
            firebaseService.getFollowingCount(userId)
        ]);

        const payload = {
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
            teamIds: buildUserTeamIds(user),
            followersCount,
            followingCount,
            surveyCompleted: user.surveyCompleted === true,
            surveyPreferences: user.surveyPreferences || null
        };

        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                payload.isFollowing = await firebaseService.isFollowing(decoded.userId, userId);
            } catch (_) { payload.isFollowing = false; }
        } else {
            payload.isFollowing = false;
        }

        res.json(payload);
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

// Send message/post to general chat (supports text and/or image; optional parentMessageId for replies)
app.post('/api/chat/general', authenticateToken, async (req, res) => {
    try {
        const { text, imageBase64, imageMimeType, parentMessageId } = req.body;
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const hasText = text && String(text).trim();
        const hasImage = imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 0;
        if (!hasText && !hasImage) return res.status(400).json({ error: 'Message text or image required' });
        // Replies: text only, no image
        const isReply = parentMessageId && String(parentMessageId).trim();
        const finalImage = isReply ? null : imageBase64;
        const finalMime = isReply ? null : imageMimeType;

        if (hasText) {
            const mod = await moderateChatText(String(text));
            if (!mod.allowed) {
                console.warn('[chat moderation] Blocked general message', { userId, categories: mod.categories });
                return res.status(400).json({ error: mod.userMessage, code: 'moderation_blocked' });
            }
        }

        const message = await firebaseService.createMessage('general', userId, user.username, text || '', null, finalImage, finalMime || 'image/jpeg', isReply ? parentMessageId : null);
        res.json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Toggle like on a general-chat message
app.post('/api/chat/messages/:id/like', authenticateToken, async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = parseInt(req.user.userId);
        const message = await firebaseService.getMessageById(messageId);
        if (!message) return res.status(404).json({ error: 'Message not found' });
        if ((message.conversationId || '') !== 'general') {
            return res.status(403).json({ error: 'Can only like posts in General Chat' });
        }
        const likedBy = Array.isArray(message.likedBy) ? message.likedBy.map(id => parseInt(id)) : [];
        const idx = likedBy.indexOf(userId);
        if (idx === -1) likedBy.push(userId);
        else likedBy.splice(idx, 1);
        const updated = await firebaseService.updateMessage(messageId, { likedBy });
        res.json({ likedBy: updated.likedBy || [], liked: idx === -1 });
    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: 'Failed to update like' });
    }
});

// Team chat: get list of teams the current user belongs to
app.get('/api/chat/team/list', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);
        if (!teamIds.length) {
            return res.status(400).json({ error: 'You are not in any teams yet' });
        }
        const allTeams = await firebaseService.getAllTeams();
        const teams = allTeams.filter(t => teamIds.includes(t.id));
        res.json(teams);
    } catch (error) {
        console.error('Error fetching user teams for chat:', error);
        res.status(500).json({ error: 'Failed to fetch user teams' });
    }
});

// Team chat: get messages for a specific team the user belongs to
app.get('/api/chat/team', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);
        if (!teamIds.length) {
            return res.status(400).json({ error: 'You are not in a team yet' });
        }

        const requestedTeamId = req.query.teamId ? parseInt(req.query.teamId) : null;
        const teamIdToUse = requestedTeamId && !Number.isNaN(requestedTeamId)
            ? requestedTeamId
            : teamIds[0];

        if (!userHasTeam(user, teamIdToUse)) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const convId = `team_${teamIdToUse}`;
        const messages = await firebaseService.getMessagesByConversation(convId);
        res.json(messages);
    } catch (error) {
        console.error('Error fetching team chat:', error);
        res.status(500).json({ error: 'Failed to fetch team messages' });
    }
});

// Team chat: send message to a specific team the user belongs to
app.post('/api/chat/team', authenticateToken, async (req, res) => {
    try {
        const { text, teamId } = req.body;
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);

        if (!teamIds.length) {
            return res.status(400).json({ error: 'You must be in a team to use team chat' });
        }
        if (!text || !String(text).trim()) {
            return res.status(400).json({ error: 'Message text required' });
        }

        const modTeam = await moderateChatText(String(text));
        if (!modTeam.allowed) {
            console.warn('[chat moderation] Blocked team message', { userId, categories: modTeam.categories });
            return res.status(400).json({ error: modTeam.userMessage, code: 'moderation_blocked' });
        }

        const requestedTeamId = teamId ? parseInt(teamId) : null;
        const teamIdToUse = requestedTeamId && !Number.isNaN(requestedTeamId)
            ? requestedTeamId
            : teamIds[0];

        if (!userHasTeam(user, teamIdToUse)) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const convId = `team_${teamIdToUse}`;
        const message = await firebaseService.createMessage(convId, userId, user.username, text);
        res.json(message);
    } catch (error) {
        console.error('Error sending team message:', error);
        res.status(500).json({ error: 'Failed to send team message' });
    }
});

// Team chat: get team info and members for a specific team the user belongs to
app.get('/api/chat/team/meta', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const teamIds = buildUserTeamIds(user);
        if (!teamIds.length) {
            return res.status(400).json({ error: 'You are not in a team yet' });
        }

        const requestedTeamId = req.query.teamId ? parseInt(req.query.teamId) : null;
        const teamIdToUse = requestedTeamId && !Number.isNaN(requestedTeamId)
            ? requestedTeamId
            : teamIds[0];

        if (!userHasTeam(user, teamIdToUse)) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const team = await firebaseService.getTeamById(teamIdToUse);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        const allUsers = await firebaseService.getAllUsers();
        const members = allUsers
            .filter(u => userHasTeam(u, team.id))
            .map(u => ({
                id: u.id,
                username: u.username,
                firstName: u.firstName || '',
                lastName: u.lastName || ''
            }));
        res.json({ team, members });
    } catch (error) {
        console.error('Error fetching team meta:', error);
        res.status(500).json({ error: 'Failed to fetch team info' });
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

// DM inbox — MUST be registered before /api/chat/dm/:otherUserId or "partners" is treated as a user id.
app.get('/api/chat/dm/partners', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const partners = await firebaseService.getDmPartnersList(userId);
        res.json(partners);
    } catch (error) {
        console.error('Error fetching DM partners:', error);
        res.status(500).json({ error: 'Failed to load conversations' });
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

        const modDm = await moderateChatText(String(text));
        if (!modDm.allowed) {
            console.warn('[chat moderation] Blocked DM', { userId, recipientId: otherUserId, categories: modDm.categories });
            return res.status(400).json({ error: modDm.userMessage, code: 'moderation_blocked' });
        }

        const convId = firebaseService.getDmConversationId(userId, otherUserId);
        const message = await firebaseService.createMessage(convId, userId, user.username, text, otherUserId);
        res.json(message);
    } catch (error) {
        console.error('Error sending DM:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Search users to start a new DM — requires ?q= (non-empty); never returns the full directory
app.get('/api/chat/users', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const q = (req.query.q || '').trim().toLowerCase();
        if (!q) {
            return res.json([]);
        }
        const allUsers = await firebaseService.getAllUsers();
        const matches = allUsers
            .filter(u => u.id !== userId && u.role !== 'super_admin')
            .filter(u => {
                const uu = (u.username || '').toLowerCase();
                const fn = (u.firstName || '').toLowerCase();
                const ln = (u.lastName || '').toLowerCase();
                const full = (`${fn} ${ln}`).trim();
                return uu.includes(q) || fn.includes(q) || ln.includes(q) || full.includes(q);
            })
            .slice(0, 25)
            .map(u => ({
                id: u.id,
                username: u.username,
                firstName: u.firstName || '',
                lastName: u.lastName || ''
            }));
        matches.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
        res.json(matches);
    } catch (error) {
        console.error('Error searching chat users:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

// Unread message counts since last read (general, per-DM partner, per-team)
app.get('/api/chat/unread', authenticateToken, async (req, res) => {
    try {
        const summary = await firebaseService.getChatUnreadSummary(req.user.userId);
        res.json(summary);
    } catch (error) {
        console.error('Error fetching chat unread:', error);
        res.status(500).json({ error: 'Failed to fetch unread counts' });
    }
});

// Mark a channel as read up to now (updates Firestore chatLastRead)
app.post('/api/chat/read', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { channel, otherUserId, teamId } = req.body || {};

        if (channel === 'general') {
            await firebaseService.markChatLastRead(userId, 'general', {});
            return res.json({ ok: true });
        }
        if (channel === 'dm') {
            const oid = otherUserId != null ? parseInt(otherUserId, 10) : NaN;
            if (Number.isNaN(oid)) {
                return res.status(400).json({ error: 'otherUserId required for dm' });
            }
            const other = await firebaseService.getUserById(oid);
            if (!other) return res.status(404).json({ error: 'User not found' });
            await firebaseService.markChatLastRead(userId, 'dm', { otherUserId: oid });
            return res.json({ ok: true });
        }
        if (channel === 'team') {
            const tid = teamId != null ? parseInt(teamId, 10) : NaN;
            if (Number.isNaN(tid)) {
                return res.status(400).json({ error: 'teamId required for team' });
            }
            const user = await firebaseService.getUserById(userId);
            if (!user) return res.status(404).json({ error: 'User not found' });
            if (!userHasTeam(user, tid)) {
                return res.status(403).json({ error: 'You are not a member of this team' });
            }
            await firebaseService.markChatLastRead(userId, 'team', { teamId: tid });
            return res.json({ ok: true });
        }
        return res.status(400).json({ error: 'Invalid channel (general, dm, or team)' });
    } catch (error) {
        console.error('Error marking chat read:', error);
        res.status(500).json({ error: 'Failed to update read state' });
    }
});

// ============================================
// CHALLENGE ROUTES
// ============================================

// Get all challenges (no-cache so users always see admin-added challenges)
app.get('/api/challenges', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const challenges = filterPublicChallenges(await firebaseService.getAllChallenges());
        res.json(challenges);
    } catch (error) {
        console.error('Error fetching challenges:', error);
        res.status(500).json({ error: 'Failed to fetch challenges' });
    }
});

// User: Suggest/add a new challenge (non-admin) — OpenAI approves, cleans, and enriches
app.post('/api/challenges/custom', authenticateToken, async (req, res) => {
    try {
        const { name, description, points, category, difficulty, duration, co2Saved } = req.body;
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!name || !description) {
            return res.status(400).json({ error: 'Name and description are required' });
        }

        const rawName = String(name).trim();
        const rawDesc = String(description).trim();
        const validCategories = ['Reduce', 'Nature', 'Transport', 'Food', 'Energy'];
        const validDifficulties = ['Easy', 'Medium', 'Hard'];
        const userCategory = category && validCategories.includes(category) ? category : null;
        const userDifficulty = difficulty && validDifficulties.includes(difficulty) ? difficulty : null;
        const userDuration = duration ? String(duration).trim() : null;
        const userPoints = points ? parseInt(points) : null;
        const userCO2 = co2Saved ? parseFloat(co2Saved) : null;

        const hasOpenAI =
            OPENAI_API_KEY &&
            OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY_HERE';

        let cleanedDescription = rawDesc;
        let suggestedCategory = userCategory || 'Reduce';
        let suggestedDifficulty = userDifficulty || 'Easy';
        let suggestedDuration = userDuration || '1 day';
        let suggestedCO2 = userCO2 ?? 1;
        let suggestedPoints = userPoints ?? 25;
        let approved = true;

        if (hasOpenAI) {
            try {
                const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        response_format: { type: 'json_object' },
                        messages: [
                            {
                                role: 'system',
                                content: `You are an eco-challenge moderator for GreenGoals (college students). Users prove completion by uploading ONE photo that must reasonably match the challenge. Review user-submitted challenges and:
1. APPROVE or REJECT: Approve if it's valid, eco-friendly, and **photo-verifiable** (reviewer can tell from a picture). Reject if it's spam, inappropriate, not eco-related, too vague, or **cannot be proven with a photo** (e.g. "take shorter showers", "always unplug", honor-system-only habits). Reject if it needs private land or major resources (e.g. plant a full tree in a yard, install home solar, buy an EV). If approved, ensure the cleaned description hints what kind of photo counts (e.g. "Photo: your reusable mug at the dining hall").
2. If approved: clean the description (fix grammar, improve clarity, make it action-oriented).
3. If approved: pick the best category from exactly: Reduce, Nature, Transport, Food, Energy.
4. If approved: pick difficulty: Easy, Medium, or Hard based on effort and commitment required.
5. If approved: suggest duration (e.g. "1 day", "1 week", "3 days") based on the challenge.
6. If approved: estimate kg CO2 saved (typical range 0.5–50 kg depending on the action).
7. If approved: suggest points (15–100 based on difficulty and impact: Easy 15–30, Medium 30–60, Hard 60–100).
Respond ONLY as JSON with: approved (boolean), rejectionReason (string, only if rejected), cleanedDescription (string), suggestedCategory (one of: Reduce, Nature, Transport, Food, Energy), suggestedDifficulty (Easy, Medium, or Hard), suggestedDuration (string), suggestedCO2 (number), suggestedPoints (number).`
                            },
                            {
                                role: 'user',
                                content: `Challenge name: "${rawName}"\nDescription: "${rawDesc}"`
                            }
                        ]
                    })
                });

                if (aiRes.ok) {
                    const aiJson = await aiRes.json();
                    const content = aiJson.choices?.[0]?.message?.content || '{}';
                    try {
                        const parsed = JSON.parse(content);
                        approved = !!parsed.approved;
                        if (!approved && parsed.rejectionReason) {
                            return res.status(400).json({
                                error: 'Challenge not approved',
                                reason: parsed.rejectionReason
                            });
                        }
                        if (approved) {
                            cleanedDescription = parsed.cleanedDescription || rawDesc;
                            suggestedCategory = validCategories.includes(parsed.suggestedCategory) ? parsed.suggestedCategory : (userCategory || 'Reduce');
                            suggestedDifficulty = validDifficulties.includes(parsed.suggestedDifficulty) ? parsed.suggestedDifficulty : (userDifficulty || 'Easy');
                            suggestedDuration = parsed.suggestedDuration || userDuration || '1 day';
                            suggestedCO2 = typeof parsed.suggestedCO2 === 'number' ? parsed.suggestedCO2 : (userCO2 ?? 1);
                            suggestedPoints = typeof parsed.suggestedPoints === 'number' ? parsed.suggestedPoints : (userPoints ?? 25);
                        }
                    } catch (e) {
                        console.error('Failed to parse OpenAI challenge JSON:', e);
                    }
                } else {
                    console.error('OpenAI challenge review error:', aiRes.status);
                }
            } catch (aiError) {
                console.error('Error calling OpenAI for challenge:', aiError);
            }
        }

        const newChallenge = {
            name: rawName,
            description: cleanedDescription,
            points: suggestedPoints,
            category: suggestedCategory,
            difficulty: suggestedDifficulty,
            duration: suggestedDuration,
            co2Saved: suggestedCO2,
            userCreated: true,
            createdByUserId: user.id,
            createdByUsername: user.username || '',
            createdAt: new Date().toISOString(),
            aiApprovalStatus: 'live'
        };

        const createdChallenge = await firebaseService.createChallenge(newChallenge);
        res.json({
            message: 'Challenge created!',
            challenge: createdChallenge,
            aiEnriched: hasOpenAI && approved
        });
    } catch (error) {
        console.error('Error creating user challenge:', error);
        res.status(500).json({ error: 'Failed to create challenge' });
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

        // Keep pending evidence saved for admin review; user can re-upload new evidence if they re-accept

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

// Submit evidence for a challenge (uses OpenAI for auto-review when configured)
app.post('/api/challenges/:id/submit-evidence', authenticateToken, async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        const challengeId = parseInt(req.params.id);
        const userId = req.user.userId;

        let user = await firebaseService.getUserById(userId);
        const challenge = await firebaseService.getChallengeById(challengeId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }

        let activeIds = (user.activeChallenges || []).map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
        if (!activeIds.includes(challengeId)) {
            const usersWithChallenge = await firebaseService.getUsersWithChallengeInActive(challengeId);
            const matchingUser = usersWithChallenge.find(u => parseInt(u.id) === parseInt(userId));
            if (matchingUser) {
                user = matchingUser;
                activeIds = (user.activeChallenges || []).map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
            } else {
                return res.status(400).json({ error: 'Challenge not in progress. Accept the challenge first from the Challenges page.' });
            }
        }

        if (!imageBase64) {
            return res.status(400).json({ error: 'Please provide an image' });
        }

        // If OpenAI key is not configured, fall back to legacy "pending admin review" flow
        const hasOpenAI =
            OPENAI_API_KEY &&
            OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY_HERE';

        if (!hasOpenAI) {
            // Delete any existing pending evidence so user can replace (e.g. after abandon + re-accept)
            const userEvidence = await firebaseService.getEvidenceByUserId(userId);
            const existingPending = userEvidence.filter(
                e => (e.challengeId === challengeId || e.challengeId == challengeId) && e.status === 'pending'
            );
            for (const ev of existingPending) {
                await firebaseService.deleteEvidence(ev.id);
            }

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
                status: 'pending',
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
        }

        // ===============================
        // OpenAI auto-review path
        // ===============================

        let aiApproved = false;
        let aiReason = 'No explanation';
        let aiConfidence = 0;

        try {
            const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4.1-mini',
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an eco-challenge evidence reviewer. The challenge description often says what photo is expected. Given the description and the user\'s photo, decide if the image reasonably proves they completed the challenge (object, setting, or action visible). Reject stock/random unrelated images. Respond ONLY as JSON: approved (boolean), reason (string), confidence (0–1). Be strict but fair.'
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: `Challenge: ${challenge.name}\nDescription: ${challenge.description || ''}\n\nDoes this photo clearly show the user has completed this challenge?`
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/jpeg;base64,${imageBase64}`
                                    }
                                }
                            ]
                        }
                    ]
                })
            });

            if (!aiRes.ok) {
                console.error('OpenAI error status:', aiRes.status);
            } else {
                const aiJson = await aiRes.json();
                const content = aiJson.choices?.[0]?.message?.content || '{}';
                try {
                    const parsed = JSON.parse(content);
                    aiApproved = !!parsed.approved;
                    aiReason = parsed.reason || aiReason;
                    aiConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : aiConfidence;
                } catch (e) {
                    console.error('Failed to parse OpenAI response JSON:', e);
                }
            }
        } catch (aiError) {
            console.error('Error calling OpenAI:', aiError);
        }

        const nowIso = new Date().toISOString();
        const status = aiApproved ? 'approved' : 'rejected';

        // Create evidence record with AI decision
        const evidenceRecord = {
            userId: userId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            challengeId: challengeId,
            challengeName: challenge.name,
            challengePoints: challenge.points,
            challengeCO2: challenge.co2Saved,
            imageBase64: imageBase64,
            status,
            submittedAt: nowIso,
            reviewedAt: nowIso,
            reviewNotes: `${aiReason} (AI auto-review, confidence=${aiConfidence})`
        };

        await firebaseService.createEvidence(evidenceRecord);

        if (aiApproved) {
            // Mark challenge as completed for the user and award points
            const active = Array.isArray(user.activeChallenges) ? user.activeChallenges : [];
            const completed = Array.isArray(user.completedChallenges) ? user.completedChallenges : [];

            const newActive = active.filter(id => id !== challengeId);
            const newCompleted = completed.includes(challengeId)
                ? completed
                : [...completed, challengeId];

            const newPoints = (user.points || 0) + (challenge.points || 0);
            const newCO2 = (user.totalCO2Saved || 0) + (challenge.co2Saved || 0);

            await firebaseService.updateUser(userId, {
                activeChallenges: newActive,
                completedChallenges: newCompleted,
                points: newPoints,
                totalCO2Saved: newCO2
            });

            return res.json({
                approved: true,
                message: `Nice work on "${challenge.name}" – your evidence looks valid!`,
                reason: aiReason,
                pointsEarned: challenge.points || 0
            });
        } else {
            return res.json({
                approved: false,
                message: 'We could not confidently verify this photo as proof for the challenge.',
                reason: aiReason
            });
        }
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

// Admin: Get all evidence (including reviewed) - with images; enrich challenge meta for UI grouping
app.get('/api/admin/all-evidence', authenticateAdmin, async (req, res) => {
    try {
        const allEvidence = await firebaseService.getAllEvidence();
        const challenges = await firebaseService.getAllChallenges();
        const chById = new Map(challenges.map((c) => [Number(c.id), c]));
        const enriched = allEvidence.map((e) => {
            const cid = e.challengeId != null ? Number(e.challengeId) : NaN;
            const ch = Number.isFinite(cid) ? chById.get(cid) : null;
            return {
                ...e,
                challengeName: e.challengeName || (ch && ch.name) || (Number.isFinite(cid) ? `Challenge #${cid}` : 'Unknown challenge'),
                challengeCategory: e.challengeCategory || (ch && ch.category) || '',
                challengePoints: e.challengePoints != null ? e.challengePoints : (ch && ch.points),
                challengeCO2: e.challengeCO2 != null ? e.challengeCO2 : (ch && ch.co2Saved)
            };
        });
        enriched.sort((a, b) => {
            const ta = new Date(a.reviewedAt || a.submittedAt || 0).getTime();
            const tb = new Date(b.reviewedAt || b.submittedAt || 0).getTime();
            return tb - ta;
        });
        res.json(enriched);
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

function userHasTeam(user, teamId) {
    if (!user) return false;
    const tid = parseInt(teamId);
    if (Array.isArray(user.teamIds) && user.teamIds.includes(tid)) return true;
    return parseInt(user.teamId) === tid;
}

function buildUserTeamIds(user) {
    const base = [];
    if (Array.isArray(user.teamIds)) {
        user.teamIds.forEach(id => {
            const n = parseInt(id);
            if (!Number.isNaN(n) && !base.includes(n)) base.push(n);
        });
    } else if (user.teamId) {
        const n = parseInt(user.teamId);
        if (!Number.isNaN(n)) base.push(n);
    }
    return base;
}

async function addUserToTeamMembership(user, teamId) {
    const tid = parseInt(teamId);
    if (Number.isNaN(tid)) return user;
    const teamIds = buildUserTeamIds(user);
    if (!teamIds.includes(tid)) {
        teamIds.push(tid);
    }
    const updates = { teamIds };
    // Preserve existing primary team; if none, set this as primary
    if (!user.teamId) {
        updates.teamId = tid;
    }
    return firebaseService.updateUser(user.id, updates);
}

async function removeUserFromTeamMembership(user, teamId) {
    const tid = parseInt(teamId);
    if (Number.isNaN(tid)) return user;
    const teamIds = buildUserTeamIds(user).filter(id => id !== tid);
    const updates = { teamIds };
    if (parseInt(user.teamId) === tid) {
        updates.teamId = teamIds.length ? teamIds[0] : null;
    }
    return firebaseService.updateUser(user.id, updates);
}

// Get all teams
app.get('/api/teams', async (req, res) => {
    try {
        const teams = await firebaseService.getAllTeams();
        const allUsers = await firebaseService.getAllUsers();
        const teamsWithMembers = teams.map(t => ({
            ...t,
            memberCount: allUsers.filter(u => userHasTeam(u, t.id)).length
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

        const newTeam = {
            name,
            description,
            leaderId: userId,
            totalPoints: user.points || 0,
            createdAt: new Date().toISOString()
        };

        const createdTeam = await firebaseService.createTeam(newTeam);
        const updatedUser = await addUserToTeamMembership(user, createdTeam.id);
        await firebaseService.updateTeam(createdTeam.id, {
            totalPoints: createdTeam.totalPoints || (updatedUser.points || 0)
        });

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

        if (userHasTeam(user, teamId)) {
            return res.status(400).json({ error: 'Already in this team' });
        }

        const updatedUser = await addUserToTeamMembership(user, teamId);
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (updatedUser.points || 0)
        });

        const updatedTeam = await firebaseService.getTeamById(teamId);
        res.json({ message: `Joined team: ${team.name}!`, team: updatedTeam });
    } catch (error) {
        console.error('Error joining team:', error);
        res.status(500).json({ error: 'Failed to join team' });
    }
});

// Request to join a team (creates pending request; team leader approves later)
app.post('/api/teams/:id/request-join', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const team = await firebaseService.getTeamById(teamId);

        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        if (userHasTeam(user, teamId)) {
            return res.status(400).json({ error: 'You are already in this team' });
        }
        const existing = await firebaseService.getTeamJoinRequestByUserAndTeam(userId, teamId);
        if (existing) {
            return res.status(400).json({ error: 'You already have a pending request for this team' });
        }

        const request = await firebaseService.createTeamJoinRequest({
            teamId,
            userId,
            username: user.username || '',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        });
        res.json({ message: 'Request sent! The team leader will review it.', request });
    } catch (error) {
        console.error('Error requesting to join team:', error);
        res.status(500).json({ error: 'Failed to send request' });
    }
});

// Get pending join requests for a team (team leader or member only)
app.get('/api/teams/:id/join-requests', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const userId = req.user.userId;
        const user = await firebaseService.getUserById(userId);
        const team = await firebaseService.getTeamById(teamId);

        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (!userHasTeam(user, teamId)) {
            return res.status(403).json({ error: 'Only team members can view join requests' });
        }

        const requests = await firebaseService.getTeamJoinRequestsByTeamId(teamId);
        res.json(requests);
    } catch (error) {
        console.error('Error fetching join requests:', error);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// Approve a join request (team leader or member)
app.post('/api/teams/:id/join-requests/:requestId/approve', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const requestId = parseInt(req.params.requestId);
        const userId = req.user.userId;
        const requester = await firebaseService.getUserById(userId);
        const team = await firebaseService.getTeamById(teamId);
        const joinRequest = await firebaseService.getTeamJoinRequestById(requestId);

        if (!team || !joinRequest) return res.status(404).json({ error: 'Not found' });
        if (joinRequest.teamId !== teamId || joinRequest.status !== 'pending') {
            return res.status(400).json({ error: 'Invalid request' });
        }
        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'Only team members can approve requests' });
        }

        const userToAdd = await firebaseService.getUserById(joinRequest.userId);
        if (!userToAdd) return res.status(404).json({ error: 'User not found' });
        if (userHasTeam(userToAdd, teamId)) {
            await firebaseService.updateTeamJoinRequest(requestId, { status: 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: userId });
            return res.status(400).json({ error: 'User is already in the team' });
        }

        await addUserToTeamMembership(userToAdd, teamId);
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (userToAdd.points || 0)
        });
        await firebaseService.updateTeamJoinRequest(requestId, {
            status: 'approved',
            reviewedAt: new Date().toISOString(),
            reviewedBy: userId
        });

        res.json({ message: `${userToAdd.firstName || userToAdd.username} has been added to the team!` });
    } catch (error) {
        console.error('Error approving join request:', error);
        res.status(500).json({ error: 'Failed to approve' });
    }
});

// Reject a join request
app.post('/api/teams/:id/join-requests/:requestId/reject', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const requestId = parseInt(req.params.requestId);
        const userId = req.user.userId;
        const requester = await firebaseService.getUserById(userId);
        const joinRequest = await firebaseService.getTeamJoinRequestById(requestId);

        if (!joinRequest) return res.status(404).json({ error: 'Request not found' });
        if (joinRequest.teamId !== teamId || joinRequest.status !== 'pending') {
            return res.status(400).json({ error: 'Invalid request' });
        }
        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'Only team members can reject requests' });
        }

        await firebaseService.updateTeamJoinRequest(requestId, {
            status: 'rejected',
            reviewedAt: new Date().toISOString(),
            reviewedBy: userId
        });
        res.json({ message: 'Join request rejected' });
    } catch (error) {
        console.error('Error rejecting join request:', error);
        res.status(500).json({ error: 'Failed to reject' });
    }
});

// Leave team
app.post('/api/teams/leave', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const user = await firebaseService.getUserById(userId);
        const targetTeamId = req.body && req.body.teamId ? parseInt(req.body.teamId) : parseInt(user.teamId);

        if (!targetTeamId || Number.isNaN(targetTeamId)) {
            return res.status(400).json({ error: 'Not in a team' });
        }

        if (!userHasTeam(user, targetTeamId)) {
            return res.status(400).json({ error: 'Not in this team' });
        }

        const team = await firebaseService.getTeamById(targetTeamId);
        if (team) {
            await firebaseService.updateTeam(targetTeamId, {
                totalPoints: Math.max(0, (team.totalPoints || 0) - (user.points || 0))
            });
        }

        await removeUserFromTeamMembership(user, targetTeamId);

        res.json({ message: 'Left team successfully' });
    } catch (error) {
        console.error('Error leaving team:', error);
        res.status(500).json({ error: 'Failed to leave team' });
    }
});

// Invitee accepts a pending team member invitation (invited from Add members)
app.post('/api/user/team-member-invites/:inviteId/accept', authenticateToken, async (req, res) => {
    try {
        const inviteId = parseInt(req.params.inviteId, 10);
        const userId = req.user.userId;
        const invite = await firebaseService.getTeamMemberInviteById(inviteId);
        if (!invite || invite.status !== 'pending' || invite.inviteeUserId !== userId) {
            return res.status(400).json({ error: 'Invalid or expired invitation' });
        }
        const team = await firebaseService.getTeamById(invite.teamId);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        const userToAdd = await firebaseService.getUserById(userId);
        if (userHasTeam(userToAdd, invite.teamId)) {
            await firebaseService.updateTeamMemberInvite(inviteId, {
                status: 'accepted',
                respondedAt: new Date().toISOString()
            });
            return res.json({ message: 'You are already in this team', alreadyMember: true });
        }
        await addUserToTeamMembership(userToAdd, invite.teamId);
        await firebaseService.updateTeam(invite.teamId, {
            totalPoints: (team.totalPoints || 0) + (userToAdd.points || 0)
        });
        await firebaseService.updateTeamMemberInvite(inviteId, {
            status: 'accepted',
            respondedAt: new Date().toISOString()
        });
        const updatedTeam = await firebaseService.getTeamById(invite.teamId);
        res.json({ message: `You joined ${team.name}!`, team: updatedTeam });
    } catch (error) {
        console.error('Error accepting team invite:', error);
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});

app.post('/api/user/team-member-invites/:inviteId/decline', authenticateToken, async (req, res) => {
    try {
        const inviteId = parseInt(req.params.inviteId, 10);
        const userId = req.user.userId;
        const invite = await firebaseService.getTeamMemberInviteById(inviteId);
        if (!invite || invite.status !== 'pending' || invite.inviteeUserId !== userId) {
            return res.status(400).json({ error: 'Invalid invitation' });
        }
        await firebaseService.updateTeamMemberInvite(inviteId, {
            status: 'declined',
            respondedAt: new Date().toISOString()
        });
        res.json({ message: 'Invitation declined' });
    } catch (error) {
        console.error('Error declining team invite:', error);
        res.status(500).json({ error: 'Failed to decline invitation' });
    }
});

app.get('/api/teams/:id/member-invites/pending', authenticateToken, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id, 10);
        const requester = await firebaseService.getUserById(req.user.userId);
        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'Must be a team member' });
        }
        const list = await firebaseService.getPendingTeamMemberInvitesForTeam(teamId);
        res.json(
            list.map((inv) => ({ id: inv.id, inviteeUserId: inv.inviteeUserId, createdAt: inv.createdAt }))
        );
    } catch (error) {
        console.error('Error fetching pending member invites:', error);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// Invite a user to join the team (they accept or decline under Team requests)
app.post('/api/teams/:id/add-member', authenticateToken, async (req, res) => {
    try {
        const { userId: inviteeBodyId } = req.body;
        const teamId = parseInt(req.params.id, 10);
        const requesterId = req.user.userId;

        const requester = await firebaseService.getUserById(requesterId);
        const team = await firebaseService.getTeamById(teamId);
        const inviteeNumeric = parseInt(inviteeBodyId, 10);
        const userToInvite = await firebaseService.getUserById(inviteeNumeric);

        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        if (!userToInvite || Number.isNaN(inviteeNumeric)) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!userHasTeam(requester, teamId)) {
            return res.status(403).json({ error: 'You must be a team member to invite others' });
        }

        if (inviteeNumeric === requesterId) {
            return res.status(400).json({ error: 'You cannot invite yourself' });
        }

        if (userHasTeam(userToInvite, teamId)) {
            return res.status(400).json({ error: 'User is already in this team' });
        }

        const existingInvite = await firebaseService.getPendingTeamMemberInviteByTeamAndInvitee(teamId, inviteeNumeric);
        if (existingInvite) {
            return res.status(400).json({ error: 'An invitation is already pending for this user' });
        }

        const existingJoin = await firebaseService.getTeamJoinRequestByUserAndTeam(inviteeNumeric, teamId);
        if (existingJoin) {
            return res.status(400).json({
                error: 'This user already requested to join. Approve their request in Join requests instead.'
            });
        }

        const invite = await firebaseService.createTeamMemberInvite({
            teamId,
            inviterUserId: requesterId,
            inviteeUserId: inviteeNumeric,
            teamName: team.name || '',
            inviterUsername: requester.username || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        res.json({
            message: `Invitation sent to ${userToInvite.firstName || userToInvite.username}. They can accept it under Team requests on the Teams page.`,
            invite
        });
    } catch (error) {
        console.error('Error inviting team member:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
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
                memberCount: allUsers.filter(u => userHasTeam(u, t.id)).length
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
        const liveChallenges = challenges.filter((c) => c.aiApprovalStatus !== 'pending_admin');
        const totalChallenges = liveChallenges.length;

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
            co2Saved: parseFloat(co2Saved),
            aiApprovalStatus: 'live'
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

// Admin: Publish AI draft (approve for users) — optional body fields override before going live
app.post('/api/admin/challenges/:id/publish-ai', authenticateAdmin, async (req, res) => {
    try {
        const challengeId = parseInt(req.params.id, 10);
        if (Number.isNaN(challengeId)) {
            return res.status(400).json({ error: 'Invalid challenge id' });
        }
        const challenge = await firebaseService.getChallengeById(challengeId);
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }
        if (challenge.aiApprovalStatus !== 'pending_admin') {
            return res.status(400).json({ error: 'Challenge is not awaiting AI review' });
        }
        const body = req.body || {};
        const updates = { aiApprovalStatus: 'live' };
        if (body.name != null && String(body.name).trim()) updates.name = String(body.name).trim();
        if (body.description != null) updates.description = String(body.description).trim();
        if (body.category != null && String(body.category).trim()) updates.category = String(body.category).trim();
        if (body.difficulty != null && String(body.difficulty).trim()) updates.difficulty = String(body.difficulty).trim();
        if (body.duration != null && String(body.duration).trim()) updates.duration = String(body.duration).trim();
        if (body.cadence != null && String(body.cadence).trim()) updates.cadence = String(body.cadence).trim();
        if (body.points != null && body.points !== '') {
            const p = parseInt(body.points, 10);
            if (!Number.isNaN(p)) updates.points = p;
        }
        if (body.co2Saved != null && body.co2Saved !== '') {
            const co2 = parseFloat(body.co2Saved);
            if (!Number.isNaN(co2)) updates.co2Saved = co2;
        }
        await firebaseService.updateChallenge(challengeId, updates);
        const updated = await firebaseService.getChallengeById(challengeId);
        res.json({ message: 'Challenge published', challenge: updated });
    } catch (error) {
        console.error('Error publishing AI challenge:', error);
        res.status(500).json({ error: 'Failed to publish challenge' });
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
            const leader = t.leaderId != null ? await firebaseService.getUserById(t.leaderId) : null;
            const members = allUsers
                .filter(u => userHasTeam(u, t.id))
                .map(u => ({
                    id: u.id,
                    firstName: u.firstName || '',
                    lastName: u.lastName || '',
                    username: u.username
                }));

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

        // Remove this team from all members' memberships
        const allUsers = await firebaseService.getAllUsers();
        const teamMembers = allUsers.filter(u => userHasTeam(u, teamId));

        await Promise.all(teamMembers.map(user =>
            removeUserFromTeamMembership(user, teamId)
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

        const user = await firebaseService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Can't remove the leader from their own team
        if (team.leaderId === userId) {
            return res.status(400).json({ error: 'Cannot remove team leader. Delete the team instead.' });
        }

        if (!userHasTeam(user, teamId)) {
            return res.status(400).json({ error: 'User is not a member of this team' });
        }

        await removeUserFromTeamMembership(user, teamId);

        res.json({ message: 'Member removed from team!' });
    } catch (error) {
        console.error('Error removing team member:', error);
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});

// Admin: Add member to team
app.post('/api/admin/teams/:id/add-member', authenticateAdmin, async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const { userId, username } = req.body || {};

        const team = await firebaseService.getTeamById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        let user = null;
        if (userId) {
            user = await firebaseService.getUserById(parseInt(userId));
        } else if (username) {
            user = await firebaseService.getUserByUsername(String(username).trim());
        } else {
            return res.status(400).json({ error: 'userId or username is required' });
        }

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.role === 'super_admin' || user.role === 'admin') {
            return res.status(400).json({ error: 'Cannot add admin users to teams' });
        }

        if (user.teamId) {
            if (parseInt(user.teamId) === teamId) {
                return res.status(400).json({ error: 'User is already in this team' });
            }
            return res.status(400).json({ error: 'User is already in another team' });
        }

        await firebaseService.updateUser(user.id, { teamId });
        await firebaseService.updateTeam(teamId, {
            totalPoints: (team.totalPoints || 0) + (user.points || 0)
        });

        const updatedTeam = await firebaseService.getTeamById(teamId);

        res.json({
            message: `${user.firstName || user.username} has been added to ${team.name}!`,
            team: updatedTeam
        });
    } catch (error) {
        console.error('Error adding team member (admin):', error);
        res.status(500).json({ error: 'Failed to add team member' });
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

// Admin: Trigger AI challenge generation (3 daily + 3 weekly, college-focused, diverse categories)
app.post('/api/admin/generate-challenges', authenticateAdmin, async (req, res) => {
    try {
        const result = await generateAICampaignChallenges();
        res.json({ message: `Generated ${result.created} challenges`, ...result });
    } catch (error) {
        console.error('Error generating AI challenges:', error);
        res.status(500).json({ error: 'Failed to generate challenges' });
    }
});

// Cron: Generate daily + weekly college challenges every 2 days at 2:00 AM
cron.schedule('0 2 */2 * *', async () => {
    console.log('🌱 Running scheduled AI challenge generation (daily + weekly)...');
    const result = await generateAICampaignChallenges();
    console.log(`✅ AI challenges: created ${result.created}`);
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
    ║   Admin panel: http://localhost:${PORT}/admin-panel.html       ║
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

