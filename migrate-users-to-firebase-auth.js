// Migration script to create Firebase Auth users for existing Firestore users
// This script reads users from Firestore and creates corresponding Firebase Auth accounts
// Run this AFTER you've set up Firebase Auth: node migrate-users-to-firebase-auth.js

const firebaseService = require('./firebase-service');
const { admin } = require('./firebase-config');

async function migrateUsersToFirebaseAuth() {
    console.log('🚀 Starting migration of users to Firebase Auth...\n');
    
    if (!admin) {
        console.error('❌ Firebase Admin not initialized. Please check your firebase-service-account.json file.');
        process.exit(1);
    }
    
    try {
        // Get all users from Firestore
        console.log('📖 Reading users from Firestore...');
        const users = await firebaseService.getAllUsers();
        console.log(`Found ${users.length} users\n`);
        
        let migrated = 0;
        let skipped = 0;
        let errors = 0;
        
        for (const user of users) {
            try {
                // Skip if user already has Firebase UID
                if (user.firebaseUID) {
                    console.log(`  ⏭️  User ${user.username} (ID: ${user.id}) already has Firebase UID, skipping...`);
                    skipped++;
                    continue;
                }
                
                // Skip if user doesn't have email
                if (!user.email) {
                    console.log(`  ⏭️  User ${user.username} (ID: ${user.id}) has no email, skipping...`);
                    skipped++;
                    continue;
                }
                
                // Skip admin users (they might have special setup)
                if (user.role === 'super_admin') {
                    console.log(`  ⏭️  Admin user ${user.username} (ID: ${user.id}), skipping (create manually)...`);
                    skipped++;
                    continue;
                }
                
                // Check if Firebase Auth user already exists
                let firebaseUser;
                try {
                    firebaseUser = await admin.auth().getUserByEmail(user.email);
                    console.log(`  ℹ️  Firebase Auth user already exists for ${user.email}`);
                } catch (error) {
                    if (error.code === 'auth/user-not-found') {
                        // User doesn't exist, we'll create one below
                        firebaseUser = null;
                    } else {
                        throw error;
                    }
                }
                
                if (!firebaseUser) {
                    // Create Firebase Auth user
                    // Note: We can't set password here, user will need to reset password
                    // Or you can set a temporary password
                    const tempPassword = `TempPass${user.id}${Date.now()}`;
                    
                    firebaseUser = await admin.auth().createUser({
                        email: user.email,
                        emailVerified: false,
                        password: tempPassword,
                        displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
                        disabled: false
                    });
                    
                    console.log(`  ✅ Created Firebase Auth user for ${user.email}`);
                }
                
                // Update Firestore user with Firebase UID
                await firebaseService.updateUser(user.id, {
                    firebaseUID: firebaseUser.uid
                });
                
                console.log(`  ✅ Migrated user: ${user.username} (ID: ${user.id}, Firebase UID: ${firebaseUser.uid})`);
                migrated++;
                
            } catch (error) {
                console.error(`  ❌ Error migrating user ${user.username} (ID: ${user.id}):`, error.message);
                errors++;
            }
        }
        
        console.log('\n✅ Migration completed!');
        console.log(`   Migrated: ${migrated}`);
        console.log(`   Skipped: ${skipped}`);
        console.log(`   Errors: ${errors}`);
        console.log('\n📝 Important Notes:');
        console.log('   - Users created with temporary passwords need to reset their password');
        console.log('   - Admin users should be created manually in Firebase Console');
        console.log('   - Users can use "Forgot Password" to set their password');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrateUsersToFirebaseAuth().then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
