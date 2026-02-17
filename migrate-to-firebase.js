// Migration script to transfer data from database.json to Firebase Firestore
// Run this script once to migrate your existing data: node migrate-to-firebase.js

const fs = require('fs');
const path = require('path');
const firebaseService = require('./firebase-service');

const DB_PATH = path.join(__dirname, 'database.json');

async function migrateData() {
    console.log('🚀 Starting migration from JSON to Firebase...\n');
    
    try {
        // Read JSON database
        console.log('📖 Reading database.json...');
        const data = fs.readFileSync(DB_PATH, 'utf8');
        const db = JSON.parse(data);
        
        console.log(`Found ${db.users?.length || 0} users`);
        console.log(`Found ${db.challenges?.length || 0} challenges`);
        console.log(`Found ${db.teams?.length || 0} teams`);
        console.log(`Found ${db.updates?.length || 0} updates`);
        console.log(`Found ${db.pendingEvidence?.length || 0} evidence submissions\n`);
        
        // Migrate users
        if (db.users && db.users.length > 0) {
            console.log('👥 Migrating users...');
            for (const user of db.users) {
                try {
                    // Check if user already exists
                    const existing = await firebaseService.getUserById(user.id);
                    if (existing) {
                        console.log(`  ⏭️  User ${user.username} (ID: ${user.id}) already exists, skipping...`);
                        continue;
                    }
                    
                    // Create user document with ID
                    const { db } = require('./firebase-config');
                    if (!db) {
                        throw new Error('Firebase not initialized');
                    }
                    
                    await db.collection('users').doc(user.id.toString()).set({
                        ...user,
                        id: user.id
                    });
                    console.log(`  ✅ Migrated user: ${user.username} (ID: ${user.id})`);
                } catch (error) {
                    console.error(`  ❌ Error migrating user ${user.username}:`, error.message);
                }
            }
            console.log('');
        }
        
        // Migrate challenges
        if (db.challenges && db.challenges.length > 0) {
            console.log('🎯 Migrating challenges...');
            for (const challenge of db.challenges) {
                try {
                    const existing = await firebaseService.getChallengeById(challenge.id);
                    if (existing) {
                        console.log(`  ⏭️  Challenge "${challenge.name}" (ID: ${challenge.id}) already exists, skipping...`);
                        continue;
                    }
                    
                    const { db } = require('./firebase-config');
                    if (!db) {
                        throw new Error('Firebase not initialized');
                    }
                    
                    await db.collection('challenges').doc(challenge.id.toString()).set({
                        ...challenge,
                        id: challenge.id
                    });
                    console.log(`  ✅ Migrated challenge: ${challenge.name} (ID: ${challenge.id})`);
                } catch (error) {
                    console.error(`  ❌ Error migrating challenge ${challenge.name}:`, error.message);
                }
            }
            console.log('');
        }
        
        // Migrate teams
        if (db.teams && db.teams.length > 0) {
            console.log('👥 Migrating teams...');
            for (const team of db.teams) {
                try {
                    const existing = await firebaseService.getTeamById(team.id);
                    if (existing) {
                        console.log(`  ⏭️  Team "${team.name}" (ID: ${team.id}) already exists, skipping...`);
                        continue;
                    }
                    
                    const { db } = require('./firebase-config');
                    if (!db) {
                        throw new Error('Firebase not initialized');
                    }
                    
                    await db.collection('teams').doc(team.id.toString()).set({
                        ...team,
                        id: team.id
                    });
                    console.log(`  ✅ Migrated team: ${team.name} (ID: ${team.id})`);
                } catch (error) {
                    console.error(`  ❌ Error migrating team ${team.name}:`, error.message);
                }
            }
            console.log('');
        }
        
        // Migrate updates
        if (db.updates && db.updates.length > 0) {
            console.log('📰 Migrating updates...');
            for (const update of db.updates) {
                try {
                    const { db } = require('./firebase-config');
                    if (!db) {
                        throw new Error('Firebase not initialized');
                    }
                    
                    // Check if update exists
                    const updatesSnapshot = await db.collection('updates').where('id', '==', update.id).get();
                    if (!updatesSnapshot.empty) {
                        console.log(`  ⏭️  Update "${update.title}" (ID: ${update.id}) already exists, skipping...`);
                        continue;
                    }
                    
                    await db.collection('updates').doc(update.id.toString()).set({
                        ...update,
                        id: update.id
                    });
                    console.log(`  ✅ Migrated update: ${update.title} (ID: ${update.id})`);
                } catch (error) {
                    console.error(`  ❌ Error migrating update ${update.title}:`, error.message);
                }
            }
            console.log('');
        }
        
        // Migrate pending evidence
        if (db.pendingEvidence && db.pendingEvidence.length > 0) {
            console.log('📸 Migrating evidence submissions...');
            for (const evidence of db.pendingEvidence) {
                try {
                    const existing = await firebaseService.getEvidenceById(evidence.id);
                    if (existing) {
                        console.log(`  ⏭️  Evidence (ID: ${evidence.id}) already exists, skipping...`);
                        continue;
                    }
                    
                    const { db } = require('./firebase-config');
                    if (!db) {
                        throw new Error('Firebase not initialized');
                    }
                    
                    await db.collection('pendingEvidence').doc(evidence.id.toString()).set({
                        ...evidence,
                        id: evidence.id
                    });
                    console.log(`  ✅ Migrated evidence submission (ID: ${evidence.id})`);
                } catch (error) {
                    console.error(`  ❌ Error migrating evidence ${evidence.id}:`, error.message);
                }
            }
            console.log('');
        }
        
        console.log('✅ Migration completed successfully!');
        console.log('\n📝 Note: Your database.json file is still intact.');
        console.log('   You can delete it after verifying that Firebase has all your data.');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrateData().then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
