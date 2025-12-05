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

// Admin middleware
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        
        const db = readDatabase();
        const adminUser = db.users.find(u => u.id === user.userId);
        
        if (!adminUser || adminUser.role !== 'super_admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        req.user = user;
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
    
    const user = db.users.find(u => u.username === username);
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
            points: user.points 
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
        firstName: u.firstName,
        lastName: u.lastName,
        classYear: u.classYear,
        profilePicture: u.profilePicture,
        bio: u.bio,
        points: u.points,
        totalCO2Saved: u.totalCO2Saved,
        completedChallenges: u.completedChallenges.length,
        teamId: u.teamId
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

// Submit evidence for a challenge (with AI verification)
app.post('/api/challenges/:id/submit-evidence', authenticateToken, async (req, res) => {
    const { imageUrl, imageBase64 } = req.body;
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

    // Prepare the image for OpenAI
    let imageContent;
    if (imageBase64) {
        imageContent = { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } };
    } else if (imageUrl) {
        imageContent = { type: 'image_url', image_url: { url: imageUrl } };
    } else {
        return res.status(400).json({ error: 'Please provide an image' });
    }

    // Create verification prompt based on challenge
    const verificationPrompts = {
        'No plastic for 3 days': 'Does this image show evidence of avoiding single-use plastics, such as using reusable containers, bags, or bottles? Look for reusable items or plastic-free alternatives.',
        'Plant a tree': 'Does this image show someone planting a tree or a newly planted tree/seedling in the ground?',
        'Bike to work': 'Does this image show a bicycle, someone biking, or evidence of cycling as transportation?',
        'Meatless Monday': 'Does this image show a vegetarian or plant-based meal without any meat?',
        'Zero waste week': 'Does this image show zero-waste practices like composting, recycling, reusable items, or minimal waste?',
        'Cold shower challenge': 'Does this image show a cold shower setting, temperature display showing cold water, or related evidence?'
    };

    const prompt = verificationPrompts[challenge.name] || `Does this image show evidence of completing the challenge: "${challenge.name}" - ${challenge.description}?`;

    try {
        // Call OpenAI Vision API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that verifies if images show evidence of completing eco-friendly challenges. Respond with a JSON object containing: { "approved": true/false, "confidence": "high"/"medium"/"low", "reason": "brief explanation" }. Be encouraging but fair. If the image reasonably shows effort toward the challenge, approve it.'
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            imageContent
                        ]
                    }
                ],
                max_tokens: 300
            })
        });

        const aiResult = await response.json();
        
        if (aiResult.error) {
            // If OpenAI fails, auto-approve with a note (for demo purposes)
            console.log('OpenAI Error:', aiResult.error);
            return res.json({
                approved: true,
                message: 'Evidence submitted! Challenge completed (auto-approved).',
                reason: 'AI verification unavailable - evidence accepted.',
                challengeCompleted: true
            });
        }

        // Parse AI response
        let verification;
        try {
            const aiMessage = aiResult.choices[0].message.content;
            verification = JSON.parse(aiMessage);
        } catch (e) {
            // If can't parse, try to extract approval from text
            const aiMessage = aiResult.choices[0].message.content.toLowerCase();
            verification = {
                approved: aiMessage.includes('approved') || aiMessage.includes('yes') || aiMessage.includes('true'),
                confidence: 'medium',
                reason: aiResult.choices[0].message.content
            };
        }

        if (verification.approved) {
            // Complete the challenge
            user.activeChallenges = user.activeChallenges.filter(id => id !== challengeId);
            user.completedChallenges.push(challengeId);
            user.points += challenge.points;
            user.totalCO2Saved += challenge.co2Saved;

            // Update team points
            if (user.teamId) {
                const team = db.teams.find(t => t.id === user.teamId);
                if (team) {
                    team.totalPoints += challenge.points;
                }
            }

            writeDatabase(db);

            return res.json({
                approved: true,
                message: `🎉 Evidence approved! You completed "${challenge.name}" and earned ${challenge.points} points!`,
                reason: verification.reason,
                confidence: verification.confidence,
                challengeCompleted: true,
                pointsEarned: challenge.points,
                co2Saved: challenge.co2Saved
            });
        } else {
            return res.json({
                approved: false,
                message: 'Evidence not approved. Please try again with a clearer image.',
                reason: verification.reason,
                confidence: verification.confidence,
                challengeCompleted: false
            });
        }

    } catch (error) {
        console.error('Error verifying evidence:', error);
        // Auto-approve on error for demo purposes
        user.activeChallenges = user.activeChallenges.filter(id => id !== challengeId);
        user.completedChallenges.push(challengeId);
        user.points += challenge.points;
        user.totalCO2Saved += challenge.co2Saved;
        writeDatabase(db);

        return res.json({
            approved: true,
            message: `Evidence submitted! Challenge "${challenge.name}" completed!`,
            reason: 'Evidence accepted.',
            challengeCompleted: true,
            pointsEarned: challenge.points
        });
    }
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
    const totalUsers = db.users.length;
    const totalCO2Saved = db.users.reduce((sum, u) => sum + u.totalCO2Saved, 0);
    const totalChallengesCompleted = db.users.reduce((sum, u) => sum + u.completedChallenges.length, 0);
    const totalTeams = db.teams.length;
    
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
