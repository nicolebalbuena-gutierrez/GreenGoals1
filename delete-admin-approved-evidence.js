/**
 * One-time cleanup: delete Firestore evidence docs that were approved manually
 * in the admin UI (not via AI auto-review).
 *
 * AI-approved rows contain "AI auto-review" in reviewNotes.
 *
 * Does NOT change user points, completedChallenges, or team totals — those were
 * already applied at approve time. To fix user state, use a separate process or
 * adjust users manually in Firebase.
 *
 * Usage:
 *   node delete-admin-approved-evidence.js           # dry-run (list only)
 *   node delete-admin-approved-evidence.js --execute # actually delete
 */

require('dotenv').config();
const firebaseService = require('./firebase-service');

function isAiApproved(e) {
    return String(e.reviewNotes || '').includes('AI auto-review');
}

async function main() {
    const execute = process.argv.includes('--execute');
    const all = await firebaseService.getAllEvidence();
    const targets = all.filter((e) => e.status === 'approved' && !isAiApproved(e));

    console.log(`Total evidence: ${all.length}`);
    console.log(`Admin-approved (non-AI) to remove: ${targets.length}`);

    if (!targets.length) {
        console.log('Nothing to do.');
        return;
    }

    for (const e of targets) {
        console.log(
            ` - id=${e.id} user=${e.userId} @${e.username || '?'} challengeId=${e.challengeId} "${e.challengeName || ''}" notes=${JSON.stringify((e.reviewNotes || '').slice(0, 60))}`
        );
    }

    if (!execute) {
        console.log('\nDry run only. Run with --execute to delete these records.');
        return;
    }

    for (const e of targets) {
        await firebaseService.deleteEvidence(e.id);
        console.log(`Deleted evidence id ${e.id}`);
    }
    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
