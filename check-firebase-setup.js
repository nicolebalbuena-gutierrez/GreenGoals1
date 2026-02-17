// Quick script to check if Firebase is set up correctly
const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Firebase setup...\n');

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
const databasePath = path.join(__dirname, 'database.json');

// Check service account file
if (fs.existsSync(serviceAccountPath)) {
    console.log('✅ firebase-service-account.json found!');
    try {
        const content = fs.readFileSync(serviceAccountPath, 'utf8');
        const json = JSON.parse(content);
        console.log(`   Project ID: ${json.project_id || 'Not found'}`);
        console.log(`   Client Email: ${json.client_email || 'Not found'}`);
        console.log('   File looks valid!\n');
    } catch (error) {
        console.log('   ❌ File exists but contains invalid JSON!');
        console.log(`   Error: ${error.message}\n`);
    }
} else {
    console.log('❌ firebase-service-account.json NOT found!');
    console.log('   Please download it from Firebase Console:\n');
    console.log('   1. Go to https://console.firebase.google.com/');
    console.log('   2. Select your project');
    console.log('   3. Click ⚙️ → Project Settings → Service Accounts');
    console.log('   4. Click "Generate new private key"');
    console.log('   5. Save as firebase-service-account.json in project root\n');
}

// Check database.json
if (fs.existsSync(databasePath)) {
    console.log('✅ database.json found!');
    try {
        const content = fs.readFileSync(databasePath, 'utf8');
        const db = JSON.parse(content);
        console.log(`   Users: ${db.users?.length || 0}`);
        console.log(`   Challenges: ${db.challenges?.length || 0}`);
        console.log(`   Teams: ${db.teams?.length || 0}`);
        console.log(`   Updates: ${db.updates?.length || 0}`);
        console.log(`   Evidence: ${db.pendingEvidence?.length || 0}`);
        console.log('   Ready to migrate!\n');
    } catch (error) {
        console.log('   ⚠️  database.json exists but may be corrupted');
        console.log(`   Error: ${error.message}\n`);
    }
} else {
    console.log('⚠️  database.json not found - no data to migrate\n');
}

// Final status
if (fs.existsSync(serviceAccountPath)) {
    console.log('✅ Ready to run migration!');
    console.log('   Run: node migrate-to-firebase.js\n');
} else {
    console.log('❌ Cannot run migration yet - missing service account file\n');
}
