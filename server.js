const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'greengoals-secret-key-2025';

// OpenAI API Key - Replace 'YOUR_OPENAI_API_KEY_HERE' with your actual key from platform.openai.com
// Example: const OPENAI_API_KEY = 'sk-proj-abc123...';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY_HERE';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for image uploads
app.use(express.static('public'));

// Database file path
const DB_PATH = path.join(__dirname, 'database.json');

// Read/Write database
function readDatabase() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { users: [], challenges: [], teams: [] };
    }
}

function writeDatabase(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Initialize database with sample data if empty
function initializeDatabase() {
    const db = readDatabase();
    
    if (db.challenges.length === 0) {
        db.challenges = [
            { id: 1, name: 'No plastic for 3 days', description: 'Avoid single-use plastics for 3 consecutive days', points: 50, category: 'Reduce', difficulty: 'Medium', duration: '3 days', co2Saved: 2.5 },
            { id: 2, name: 'Plant a tree', description: 'Plant a tree in your community or backyard', points: 100, category: 'Nature', difficulty: 'Hard', duration: '1 day', co2Saved: 22 },
            { id: 3, name: 'Bike to work', description: 'Use a bicycle instead of car for commuting', points: 35, category: 'Transport', difficulty: 'Easy', duration: '1 day', co2Saved: 1.8 },
            { id: 4, name: 'Meatless Monday', description: 'Go vegetarian for an entire Monday', points: 25, category: 'Food', difficulty: 'Easy', duration: '1 day', co2Saved: 3.6 },
            { id: 5, name: 'Zero waste week', description: 'Produce zero landfill waste for one week', points: 150, category: 'Reduce', difficulty: 'Hard', duration: '7 days', co2Saved: 8.2 },
            { id: 6, name: 'Cold shower challenge', description: 'Take cold showers for 5 days to save energy', points: 40, category: 'Energy', difficulty: 'Medium', duration: '5 days', co2Saved: 2.1 }
        ];
        writeDatabase(db);
    }
    
    return db;
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Admin middleware - works with both regular token and admin token
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        
        const db = readDatabase();
        const adminUser = db.users.find(u => u.id === decoded.userId);
        
        if (!adminUser || adminUser.role !== 'super_admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        req.user = decoded;
        next();
    });
}

// ============================================
// AUTH ROUTES
// ============================================

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password, firstName, lastName, classYear } = req.body;
    const db = readDatabase();
    
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    if (db.users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: db.users.length + 1,
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
    
    db.users.push(newUser);
    writeDatabase(db);
    
    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET);
    res.json({ 
        token, 
        user: { 
            id: newUser.id, 
            username, 
            email,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            classYear: newUser.classYear,
            points: 0 
        } 
    });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDatabase();
    
    // Check both username and email
    const user = db.users.find(u => u.username === username || u.email === username);
    if (!user) {
        return res.status(400).json({ error: 'User not found' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
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
            points: user.points,
            isAdmin: user.role === 'super_admin'
        } 
    });
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDatabase();
    
    const user = db.users.find(u => u.username === username && u.role === 'super_admin');
    if (!user) {
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
});

// ============================================
// USER ROUTES
// ============================================

// Get all users (public - no passwords)
app.get('/api/users', (req, res) => {
    const db = readDatabase();
    const users = db.users.map(u => ({
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
});

// Get user by ID
app.get('/api/user/:id', (req, res) => {
    const db = readDatabase();
    const user = db.users.find(u => u.id === parseInt(req.params.id));
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Get full challenge details
    const activeChallenges = user.activeChallenges.map(cId => 
        db.challenges.find(c => c.id === cId)
    ).filter(Boolean);
    
    const completedChallenges = user.completedChallenges.map(cId => 
        db.challenges.find(c => c.id === cId)
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
});

// Update user profile
app.put('/api/user/profile', authenticateToken, (req, res) => {
    const { profilePicture, bio, classYear } = req.body;
    const db = readDatabase();
    const user = db.users.find(u => u.id === req.user.userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (profilePicture !== undefined) user.profilePicture = profilePicture;
    if (bio !== undefined) user.bio = bio;
    if (classYear !== undefined) user.classYear = classYear;
    
    writeDatabase(db);
    
    res.json({ 
        message: 'Profile updated successfully',
        user: {
            id: user.id,
            username: user.username,
            profilePicture: user.profilePicture,
            bio: user.bio,
            classYear: user.classYear
        }
    });
});

// ============================================
// CHALLENGE ROUTES
// ============================================

// Get all challenges
app.get('/api/challenges', (req, res) => {
    const db = readDatabase();
    res.json(db.challenges);
});

// Accept a challenge
app.post('/api/challenges/:id/accept', authenticateToken, (req, res) => {
    const db = readDatabase();
    const challengeId = parseInt(req.params.id);
    const userId = req.user.userId;

    const user = db.users.find(u => u.id === userId);
    const challenge = db.challenges.find(c => c.id === challengeId);

    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found' });
    }

    if (user.activeChallenges.includes(challengeId)) {
        return res.status(400).json({ error: 'Challenge already active' });
    }

    if (user.completedChallenges.includes(challengeId)) {
        return res.status(400).json({ error: 'Challenge already completed' });
    }

    user.activeChallenges.push(challengeId);
    writeDatabase(db);

    res.json({ message: `Started: ${challenge.name}`, challenge });
});

// Complete a challenge (direct - for admin or testing)
app.post('/api/challenges/:id/complete', authenticateToken, (req, res) => {
    const db = readDatabase();
    const challengeId = parseInt(req.params.id);
    const userId = req.user.userId;

    const user = db.users.find(u => u.id === userId);
    const challenge = db.challenges.find(c => c.id === challengeId);

    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found' });
    }

    if (!user.activeChallenges.includes(challengeId)) {
        return res.status(400).json({ error: 'Challenge not active' });
    }

    // Remove from active, add to completed
    user.activeChallenges = user.activeChallenges.filter(id => id !== challengeId);
    user.completedChallenges.push(challengeId);
    user.points += challenge.points;
    user.totalCO2Saved += challenge.co2Saved;

    // Update team points if user is in a team
    if (user.teamId) {
        const team = db.teams.find(t => t.id === user.teamId);
        if (team) {
            team.totalPoints += challenge.points;
        }
    }

    writeDatabase(db);

    res.json({ 
        message: `Completed: ${challenge.name}! +${challenge.points} points, ${challenge.co2Saved}kg CO₂ saved!`,
        user: {
            points: user.points,
            totalCO2Saved: user.totalCO2Saved,
            completedChallenges: user.completedChallenges
        }
    });
});

// Submit evidence for a challenge (sends to admin for approval)
app.post('/api/challenges/:id/submit-evidence', authenticateToken, async (req, res) => {
    const { imageBase64 } = req.body;
    const db = readDatabase();
    const challengeId = parseInt(req.params.id);
    const userId = req.user.userId;

    const user = db.users.find(u => u.id === userId);
    const challenge = db.challenges.find(c => c.id === challengeId);

    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found' });
    }

    if (!user.activeChallenges.includes(challengeId)) {
        return res.status(400).json({ error: 'Challenge not in progress' });
    }

    if (!imageBase64) {
        return res.status(400).json({ error: 'Please provide an image' });
    }

    // Initialize pendingEvidence array if it doesn't exist
    if (!db.pendingEvidence) {
        db.pendingEvidence = [];
    }

    // Check if user already submitted evidence for this challenge
    const existingSubmission = db.pendingEvidence.find(
        e => e.userId === userId && e.challengeId === challengeId && e.status === 'pending'
    );
    
    if (existingSubmission) {
        return res.status(400).json({ error: 'You already have a pending submission for this challenge. Please wait for admin review.' });
    }

    // Create new evidence submission
    const newEvidence = {
        id: db.pendingEvidence.length > 0 ? Math.max(...db.pendingEvidence.map(e => e.id)) + 1 : 1,
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

    db.pendingEvidence.push(newEvidence);
    writeDatabase(db);

    return res.json({
        pending: true,
        message: `📤 Evidence submitted! Your submission for "${challenge.name}" is now pending admin approval.`,
        submissionId: newEvidence.id
    });
});

// Get user's pending evidence submissions
app.get('/api/user/pending-evidence', authenticateToken, (req, res) => {
    const db = readDatabase();
    const userId = req.user.userId;
    
    if (!db.pendingEvidence) {
        return res.json([]);
    }
    
    const userEvidence = db.pendingEvidence.filter(e => e.userId === userId);
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
});

// Admin: Get all pending evidence
app.get('/api/admin/pending-evidence', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    
    if (!db.pendingEvidence) {
        return res.json([]);
    }
    
    // Return pending submissions (with images for admin review)
    const pendingOnly = db.pendingEvidence.filter(e => e.status === 'pending');
    res.json(pendingOnly);
});

// Admin: Get all evidence (including reviewed)
app.get('/api/admin/all-evidence', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    
    if (!db.pendingEvidence) {
        return res.json([]);
    }
    
    // Return all submissions without images (for history)
    const allEvidence = db.pendingEvidence.map(e => ({
        ...e,
        imageBase64: e.status === 'pending' ? e.imageBase64 : '[ARCHIVED]'
    }));
    res.json(allEvidence);
});

// Admin: Approve evidence
app.post('/api/admin/evidence/:id/approve', authenticateAdmin, (req, res) => {
    const { notes } = req.body;
    const db = readDatabase();
    const evidenceId = parseInt(req.params.id);
    
    if (!db.pendingEvidence) {
        return res.status(404).json({ error: 'No evidence found' });
    }
    
    const evidence = db.pendingEvidence.find(e => e.id === evidenceId);
    if (!evidence) {
        return res.status(404).json({ error: 'Evidence not found' });
    }
    
    if (evidence.status !== 'pending') {
        return res.status(400).json({ error: 'Evidence already reviewed' });
    }
    
    // Find user and challenge
    const user = db.users.find(u => u.id === evidence.userId);
    const challenge = db.challenges.find(c => c.id === evidence.challengeId);
    
    if (!user || !challenge) {
        return res.status(404).json({ error: 'User or challenge not found' });
    }
    
    // Complete the challenge for the user
    user.activeChallenges = user.activeChallenges.filter(id => id !== evidence.challengeId);
    if (!user.completedChallenges.includes(evidence.challengeId)) {
        user.completedChallenges.push(evidence.challengeId);
    }
    user.points += challenge.points;
    user.totalCO2Saved += challenge.co2Saved;
    
    // Update team points
    if (user.teamId) {
        const team = db.teams.find(t => t.id === user.teamId);
        if (team) {
            team.totalPoints += challenge.points;
        }
    }
    
    // Update evidence status
    evidence.status = 'approved';
    evidence.reviewedAt = new Date().toISOString();
    evidence.reviewNotes = notes || 'Approved by admin';
    // Clear the image data to save space
    evidence.imageBase64 = '[APPROVED - IMAGE ARCHIVED]';
    
    writeDatabase(db);
    
    res.json({ 
        message: `Approved! ${user.firstName || user.username} earned ${challenge.points} points for "${challenge.name}"`,
        evidence: {
            id: evidence.id,
            status: evidence.status,
            reviewedAt: evidence.reviewedAt
        }
    });
});

// Admin: Reject evidence
app.post('/api/admin/evidence/:id/reject', authenticateAdmin, (req, res) => {
    const { notes } = req.body;
    const db = readDatabase();
    const evidenceId = parseInt(req.params.id);
    
    if (!db.pendingEvidence) {
        return res.status(404).json({ error: 'No evidence found' });
    }
    
    const evidence = db.pendingEvidence.find(e => e.id === evidenceId);
    if (!evidence) {
        return res.status(404).json({ error: 'Evidence not found' });
    }
    
    if (evidence.status !== 'pending') {
        return res.status(400).json({ error: 'Evidence already reviewed' });
    }
    
    // Update evidence status (challenge stays in progress so user can try again)
    evidence.status = 'rejected';
    evidence.reviewedAt = new Date().toISOString();
    evidence.reviewNotes = notes || 'Rejected by admin';
    // Clear the image data
    evidence.imageBase64 = '[REJECTED - IMAGE ARCHIVED]';
    
    writeDatabase(db);
    
    res.json({ 
        message: `Evidence rejected. User can submit new evidence.`,
        evidence: {
            id: evidence.id,
            status: evidence.status,
            reviewedAt: evidence.reviewedAt,
            reviewNotes: evidence.reviewNotes
        }
    });
});

// Get user's challenges
app.get('/api/user/challenges', authenticateToken, (req, res) => {
    const db = readDatabase();
    const user = db.users.find(u => u.id === req.user.userId);
    
    const activeChallenges = user.activeChallenges.map(cId => 
        db.challenges.find(c => c.id === cId)
    ).filter(Boolean);
    
    const completedChallenges = user.completedChallenges.map(cId => 
        db.challenges.find(c => c.id === cId)
    ).filter(Boolean);
    
    res.json({ activeChallenges, completedChallenges });
});

// ============================================
// TEAM ROUTES
// ============================================

// Get all teams
app.get('/api/teams', (req, res) => {
    const db = readDatabase();
    const teams = db.teams.map(t => ({
        ...t,
        memberCount: db.users.filter(u => u.teamId === t.id).length
    }));
    res.json(teams);
});

// Create a team
app.post('/api/teams', authenticateToken, (req, res) => {
    const { name, description } = req.body;
    const db = readDatabase();
    const userId = req.user.userId;

    const user = db.users.find(u => u.id === userId);
    if (user.teamId) {
        return res.status(400).json({ error: 'Already in a team' });
    }

    const newTeam = {
        id: db.teams.length + 1,
        name,
        description,
        leaderId: userId,
        totalPoints: user.points,
        createdAt: new Date().toISOString()
    };

    db.teams.push(newTeam);
    user.teamId = newTeam.id;
    writeDatabase(db);

    res.json({ message: 'Team created!', team: newTeam });
});

// Join a team
app.post('/api/teams/:id/join', authenticateToken, (req, res) => {
    const db = readDatabase();
    const teamId = parseInt(req.params.id);
    const userId = req.user.userId;

    const user = db.users.find(u => u.id === userId);
    const team = db.teams.find(t => t.id === teamId);

    if (!team) {
        return res.status(404).json({ error: 'Team not found' });
    }

    if (user.teamId) {
        return res.status(400).json({ error: 'Already in a team' });
    }

    user.teamId = teamId;
    team.totalPoints += user.points;
    writeDatabase(db);

    res.json({ message: `Joined team: ${team.name}!`, team });
});

// Leave team
app.post('/api/teams/leave', authenticateToken, (req, res) => {
    const db = readDatabase();
    const userId = req.user.userId;

    const user = db.users.find(u => u.id === userId);
    if (!user.teamId) {
        return res.status(400).json({ error: 'Not in a team' });
    }

    const team = db.teams.find(t => t.id === user.teamId);
    if (team) {
        team.totalPoints -= user.points;
    }

    user.teamId = null;
    writeDatabase(db);

    res.json({ message: 'Left team successfully' });
});

// Add member to team (team leader can add users)
app.post('/api/teams/:id/add-member', authenticateToken, (req, res) => {
    const { userId } = req.body;
    const db = readDatabase();
    const teamId = parseInt(req.params.id);
    const requesterId = req.user.userId;

    const requester = db.users.find(u => u.id === requesterId);
    const team = db.teams.find(t => t.id === teamId);
    const userToAdd = db.users.find(u => u.id === userId);

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
    userToAdd.teamId = teamId;
    team.totalPoints = (team.totalPoints || 0) + (userToAdd.points || 0);
    
    writeDatabase(db);

    res.json({ 
        message: `${userToAdd.firstName || userToAdd.username} has been added to ${team.name}!`,
        team 
    });
});

// ============================================
// LEADERBOARD & STATS
// ============================================

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
    const db = readDatabase();
    const leaderboard = db.users
        .map(u => ({
            id: u.id,
            username: u.username,
            firstName: u.firstName,
            lastName: u.lastName,
            classYear: u.classYear,
            profilePicture: u.profilePicture,
            points: u.points,
            totalCO2Saved: u.totalCO2Saved,
            completedChallenges: u.completedChallenges.length
        }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);
    
    res.json(leaderboard);
});

// Get team leaderboard
app.get('/api/leaderboard/teams', (req, res) => {
    const db = readDatabase();
    const teamLeaderboard = db.teams
        .map(t => ({
            ...t,
            memberCount: db.users.filter(u => u.teamId === t.id).length
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints)
        .slice(0, 10);
    
    res.json(teamLeaderboard);
});

// Get platform stats
app.get('/api/stats', (req, res) => {
    const db = readDatabase();
    const totalUsers = db.users.filter(u => u.role !== 'super_admin').length;
    const totalCO2Saved = db.users.reduce((sum, u) => sum + (u.totalCO2Saved || 0), 0);
    const totalChallengesCompleted = db.users.reduce((sum, u) => {
        const completed = u.completedChallenges;
        if (Array.isArray(completed)) {
            return sum + completed.length;
        }
        return sum + (completed || 0);
    }, 0);
    const totalTeams = db.teams ? db.teams.length : 0;
    
    res.json({
        totalUsers,
        totalCO2Saved: totalCO2Saved.toFixed(1),
        totalChallengesCompleted,
        totalTeams
    });
});

// ============================================
// ADMIN ROUTES
// ============================================

// Admin: Get all challenges
app.get('/api/admin/challenges', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    res.json(db.challenges);
});

// Admin: Add new challenge
app.post('/api/admin/challenges', authenticateAdmin, (req, res) => {
    const { name, description, points, category, difficulty, duration, co2Saved } = req.body;
    const db = readDatabase();
    
    const newChallenge = {
        id: db.challenges.length > 0 ? Math.max(...db.challenges.map(c => c.id)) + 1 : 1,
        name,
        description,
        points: parseInt(points),
        category,
        difficulty,
        duration,
        co2Saved: parseFloat(co2Saved)
    };
    
    db.challenges.push(newChallenge);
    writeDatabase(db);
    
    res.json({ message: 'Challenge created!', challenge: newChallenge });
});

// Admin: Update challenge
app.put('/api/admin/challenges/:id', authenticateAdmin, (req, res) => {
    const { name, description, points, category, difficulty, duration, co2Saved } = req.body;
    const db = readDatabase();
    const challengeId = parseInt(req.params.id);
    
    const challenge = db.challenges.find(c => c.id === challengeId);
    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found' });
    }
    
    if (name) challenge.name = name;
    if (description) challenge.description = description;
    if (points) challenge.points = parseInt(points);
    if (category) challenge.category = category;
    if (difficulty) challenge.difficulty = difficulty;
    if (duration) challenge.duration = duration;
    if (co2Saved) challenge.co2Saved = parseFloat(co2Saved);
    
    writeDatabase(db);
    
    res.json({ message: 'Challenge updated!', challenge });
});

// Admin: Delete challenge
app.delete('/api/admin/challenges/:id', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    const challengeId = parseInt(req.params.id);
    
    const index = db.challenges.findIndex(c => c.id === challengeId);
    if (index === -1) {
        return res.status(404).json({ error: 'Challenge not found' });
    }
    
    db.challenges.splice(index, 1);
    writeDatabase(db);
    
    res.json({ message: 'Challenge deleted!' });
});

// Admin: Get all users
app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    const users = db.users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        classYear: u.classYear,
        points: u.points,
        totalCO2Saved: u.totalCO2Saved,
        activeChallenges: u.activeChallenges.length,
        completedChallenges: u.completedChallenges.length,
        teamId: u.teamId,
        role: u.role || 'user'
    }));
    res.json(users);
});

// Admin: Delete user
app.delete('/api/admin/users/:id', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    const userId = parseInt(req.params.id);
    
    const index = db.users.findIndex(u => u.id === userId);
    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Don't allow deleting admin
    if (db.users[index].role === 'super_admin') {
        return res.status(400).json({ error: 'Cannot delete admin user' });
    }
    
    db.users.splice(index, 1);
    writeDatabase(db);
    
    res.json({ message: 'User deleted!' });
});

// Admin: Get all teams
app.get('/api/admin/teams', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    const teams = db.teams.map(t => {
        // Get leader info
        const leader = db.users.find(u => u.id === t.leaderId);
        // Get member info
        const members = t.members.map(memberId => {
            const user = db.users.find(u => u.id === memberId);
            return user ? {
                id: user.id,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                username: user.username
            } : null;
        }).filter(m => m !== null);
        
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
    });
    res.json(teams);
});

// Admin: Update team
app.put('/api/admin/teams/:id', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    const teamId = parseInt(req.params.id);
    const { name, description } = req.body;
    
    const team = db.teams.find(t => t.id === teamId);
    if (!team) {
        return res.status(404).json({ error: 'Team not found' });
    }
    
    if (name) team.name = name;
    if (description !== undefined) team.description = description;
    
    writeDatabase(db);
    res.json({ message: 'Team updated!', team });
});

// Admin: Delete team
app.delete('/api/admin/teams/:id', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    const teamId = parseInt(req.params.id);
    
    const teamIndex = db.teams.findIndex(t => t.id === teamId);
    if (teamIndex === -1) {
        return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = db.teams[teamIndex];
    
    // Remove teamId from all members
    team.members.forEach(memberId => {
        const user = db.users.find(u => u.id === memberId);
        if (user) {
            user.teamId = null;
        }
    });
    
    // Remove the team
    db.teams.splice(teamIndex, 1);
    writeDatabase(db);
    
    res.json({ message: 'Team deleted!' });
});

// Admin: Remove member from team
app.post('/api/admin/teams/:id/remove-member', authenticateAdmin, (req, res) => {
    const db = readDatabase();
    const teamId = parseInt(req.params.id);
    const { userId } = req.body;
    
    const team = db.teams.find(t => t.id === teamId);
    if (!team) {
        return res.status(404).json({ error: 'Team not found' });
    }
    
    // Can't remove the leader
    if (team.leaderId === userId) {
        return res.status(400).json({ error: 'Cannot remove team leader. Delete the team instead.' });
    }
    
    // Remove member from team
    team.members = team.members.filter(id => id !== userId);
    
    // Update user's teamId
    const user = db.users.find(u => u.id === userId);
    if (user) {
        user.teamId = null;
    }
    
    writeDatabase(db);
    res.json({ message: 'Member removed from team!' });
});

// ============================================
// DATABASE ROUTES (for debugging)
// ============================================

// Get raw database
app.get('/api/database/raw', (req, res) => {
    const db = readDatabase();
    // Remove passwords for security
    const safeDb = {
        ...db,
        users: db.users.map(u => ({ ...u, password: '[HIDDEN]' }))
    };
    res.json(safeDb);
});

// Initialize and start server
initializeDatabase();

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
