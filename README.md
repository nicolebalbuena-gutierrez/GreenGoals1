# 🌍 GreenGoals - Social Eco-Challenges with Friends

A gamified platform for eco-friendly challenges where users can compete, form teams, and track their environmental impact!

---

## 🚀 Quick Start

### Step 1: Install Node.js
Download from https://nodejs.org (LTS version)

### Step 2: Install Dependencies
```bash
cd ~/Desktop/GreenGoals
npm install
```

### Step 3: Start the Server
```bash
npm start
```

### Step 4: Open in Browser
Go to **http://localhost:3000**

---

## 📱 Pages

| Page | URL | Description |
|------|-----|-------------|
| **Home** | `/` | Login & Register |
| **Challenges** | `/challenges.html` | Browse & accept eco-challenges |
| **Leaderboard** | `/leaderboard.html` | User & team rankings |
| **Profile** | `/profile.html` | Your stats & active challenges |
| **Database** | `/dashboard.html` | View all data (admin) |

---

## ✨ Features

### User Authentication
- Register with username, email, password
- Secure password hashing (bcrypt)
- JWT tokens for sessions

### Challenge System
- 6 eco-friendly challenges with different categories
- Accept challenges and track progress
- Complete challenges to earn points
- Categories: Reduce, Nature, Transport, Food, Energy

### Leaderboard
- Rankings by points
- CO₂ saved tracking
- Team leaderboard

### Teams
- Create or join teams
- Compete with other teams
- Combined team points

### CO₂ Tracking
- Every challenge saves CO₂
- Track your total environmental impact
- See global platform impact

---

## 📁 Project Structure

```
GreenGoals/
├── server.js              # Express backend with all API routes
├── database.json          # 👀 YOUR DATABASE - see all data here!
├── package.json           # Dependencies
├── README.md              # This file
└── public/
    ├── index.html         # Login/Register page
    ├── challenges.html    # Browse challenges
    ├── leaderboard.html   # Rankings
    ├── profile.html       # User profile
    ├── dashboard.html     # Database viewer
    ├── styles.css         # Beautiful styles
    └── app.js             # Frontend JavaScript
```

---

## 👀 Viewing the Database

### Option 1: Edit `database.json` directly
Open the file to see and edit all users, teams, and challenges!

### Option 2: Dashboard UI
Visit http://localhost:3000/dashboard.html

### Option 3: API
```bash
curl http://localhost:3000/api/database/raw
```

---

## 🔗 API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Login |

### Challenges
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/challenges` | Get all challenges |
| POST | `/api/challenges/:id/accept` | Accept a challenge (auth required) |
| POST | `/api/challenges/:id/complete` | Complete a challenge (auth required) |
| GET | `/api/user/challenges` | Get your challenges (auth required) |

### Teams
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teams` | Get all teams |
| POST | `/api/teams` | Create a team (auth required) |
| POST | `/api/teams/:id/join` | Join a team (auth required) |
| POST | `/api/teams/leave` | Leave your team (auth required) |

### Leaderboard & Stats
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leaderboard` | User rankings |
| GET | `/api/leaderboard/teams` | Team rankings |
| GET | `/api/stats` | Platform statistics |

### Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | All users (no passwords) |
| GET | `/api/user/:id` | User profile |
| GET | `/api/database/raw` | Complete database |

---

## 🎮 Sample Challenges

| Challenge | Points | CO₂ Saved | Difficulty |
|-----------|--------|-----------|------------|
| No plastic for 3 days | 50 | 2.5 kg | Medium |
| Plant a tree | 100 | 22 kg | Hard |
| Bike to work | 35 | 1.8 kg | Easy |
| Meatless Monday | 25 | 3.6 kg | Easy |
| Zero waste week | 150 | 8.2 kg | Hard |
| Cold shower challenge | 40 | 2.1 kg | Medium |

---

## 🌱 Made for GreenGoals Project Proposal

Good luck with your project! 🍀
