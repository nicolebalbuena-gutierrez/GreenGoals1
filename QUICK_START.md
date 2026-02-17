# Quick Start: Complete Migration

## Step 1: Get Your Firebase Service Account File

1. Go to https://console.firebase.google.com/
2. Select your Firebase project
3. Click the ⚙️ gear icon → **Project Settings**
4. Click the **Service Accounts** tab
5. Click **Generate new private key** button
6. A JSON file will download (usually named something like `greengoals-xxxxx-firebase-adminsdk-xxxxx.json`)

## Step 2: Save the File

1. Rename the downloaded file to: `firebase-service-account.json`
2. Move it to your project root: `/Users/nicolebalbuenagutierrez/Desktop/GreenGoals/`

**Important**: The file should be named exactly `firebase-service-account.json` (not `.md` or anything else)

## Step 3: Run Migration

Once the file is in place, run:
```bash
cd /Users/nicolebalbuenagutierrez/Desktop/GreenGoals
node migrate-to-firebase.js
```

## Step 4: Verify

1. Check the console output - it should show successful migration
2. Go to Firebase Console → Firestore Database
3. You should see your collections: users, challenges, teams, updates, pendingEvidence

## Troubleshooting

**If you get "Firebase not initialized" error:**
- Make sure the file is named exactly `firebase-service-account.json`
- Make sure it's in the project root directory
- Check that the file contains valid JSON (open it and verify)

**If migration fails:**
- Check that Firestore Database is enabled in Firebase Console
- Verify your service account has proper permissions
- Check the error message for specific issues
