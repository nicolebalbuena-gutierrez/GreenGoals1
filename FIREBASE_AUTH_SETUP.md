# Firebase Authentication Setup Guide

This guide will help you complete the Firebase Authentication setup for GreenGoals.

## Step 1: Get Firebase Web Config

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **greengoals-app**
3. Click the ⚙️ gear icon → **Project Settings**
4. Scroll down to **"Your apps"** section
5. If you don't have a web app yet:
   - Click the **</>** (web) icon
   - Register your app (nickname: "GreenGoals Web")
   - Click **Register app**
6. Copy the `firebaseConfig` object

## Step 2: Update Firebase Config File

1. Open `public/firebase-config.js`
2. Replace the placeholder values with your actual Firebase config:

```javascript
const firebaseConfig = {
    apiKey: "AIza...", // Your actual API key
    authDomain: "greengoals-app.firebaseapp.com",
    projectId: "greengoals-app",
    storageBucket: "greengoals-app.appspot.com",
    messagingSenderId: "123456789", // Your actual sender ID
    appId: "1:123456789:web:abc123" // Your actual app ID
};
```

## Step 3: Enable Email/Password Authentication

1. In Firebase Console, go to **Authentication** → **Sign-in method**
2. Click on **Email/Password**
3. Enable **Email/Password** (toggle ON)
4. Click **Save**

## Step 4: Migrate Existing Users (Optional)

If you have existing users in Firestore that need Firebase Auth accounts:

```bash
node migrate-users-to-firebase-auth.js
```

**Note**: This creates Firebase Auth users with temporary passwords. Users will need to:
- Use "Forgot Password" to set their password, OR
- You can manually set passwords in Firebase Console

## Step 5: Update HTML Files

Make sure all HTML files that need authentication include Firebase SDK scripts **before** other scripts:

```html
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>

<!-- Firebase Config and Auth -->
<script src="firebase-config.js"></script>
<script src="firebase-auth.js"></script>
```

Files that need updating:
- `public/index.html` ✅ (already updated)
- `public/home.html`
- `public/profile.html`
- `public/challenges.html`
- `public/teams.html`
- `public/leaderboard.html`
- `public/admin-panel.html`
- `public/admin-dashboard.html`

## Step 6: Test Your Application

1. Start your server:
   ```bash
   npm start
   ```

2. Test registration:
   - Go to http://localhost:3000
   - Click "Join Us"
   - Fill in the registration form
   - Submit

3. Test login:
   - Use the email and password you just registered
   - Click "Sign In"
   - You should be redirected to home page

## How It Works Now

### Registration Flow:
1. User fills registration form
2. Frontend creates Firebase Auth user with email/password
3. Frontend sends Firebase token + user data to backend
4. Backend verifies token and creates user profile in Firestore
5. User is logged in automatically

### Login Flow:
1. User enters email and password
2. Frontend authenticates with Firebase Auth
3. Frontend sends Firebase token to backend
4. Backend verifies token and returns user profile
5. User is logged in

### Authentication:
- All API requests include Firebase ID token in `Authorization: Bearer <token>` header
- Backend verifies token using Firebase Admin SDK
- No more JWT tokens or password hashing needed!

## Troubleshooting

### "Firebase SDK not loaded"
- Make sure Firebase SDK scripts are included before `firebase-config.js`
- Check browser console for script loading errors

### "Invalid API key"
- Verify your Firebase config in `firebase-config.js`
- Make sure you copied the correct values from Firebase Console

### "Email already in use"
- User already has a Firebase Auth account
- They should use "Forgot Password" if they don't remember it

### "User profile not found"
- User has Firebase Auth account but no Firestore profile
- They need to complete registration

### "Permission denied"
- Check Firestore security rules
- Make sure authenticated users can read/write their own data

## Security Notes

- Firebase handles password hashing automatically (much more secure!)
- Firebase tokens expire and refresh automatically
- No passwords stored in your database
- Firebase Auth provides built-in security features

## Next Steps

- Set up password reset functionality
- Add social login (Google, Facebook, etc.)
- Configure email verification
- Set up Firebase Hosting for production deployment
