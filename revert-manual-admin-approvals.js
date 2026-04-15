/**
 * Undo manual (non-AI) admin evidence approvals so users can go through AI review again.
 *
 * For each affected user + challenge:
 * - Removes challenge from completedChallenges
 * - Subtracts that challenge's points & CO₂ (floored at 0)
 * - Subtracts points from user's primary team (same field admin approve used: teamId)
 * - By default, adds challenge back to activeChallenges so they can submit AI evidence again
 *
 * Sources of work items:
 * 1) All evidence with status "approved" where reviewNotes does NOT contain "AI auto-review"
 * 2) Extra pairs from --pairs=userId:challengeId,userId:challengeId (for records already deleted)
 *
 * Usage:
 *   node revert-manual-admin-approvals.js
 *   node revert-manual-admin-approvals.js --pairs=4:2,4:3,4:4,4:7
 *   node revert-manual-admin-approvals.js --execute --pairs=4:2,4:3,4:4,4:7
 *   node revert-manual-admin-approvals.js --execute --no-reopen   # do not add back to active
 */

require('dotenv').config();
const firebaseService = require('./firebase-service');

function isAiApprovedEvidence(e) {
    return String(e.reviewNotes || '').includes('AI auto-review');
}

function normChallengeId(id) {
    const n = parseInt(id, 10);
    return Number.isNaN(n) ? null : n;
}

function parsePairsArg() {
    const raw = process.argv.find((a) => a.startsWith('--pairs='));
    if (!raw) return [];
    const body = raw.slice('--pairs='.length);
    return body
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            const [u, c] = s.split(':').map((x) => x.trim());
            return { userId: parseInt(u, 10), challengeId: parseInt(c, 10) };
        })
        .filter((p) => !Number.isNaN(p.userId) && !Number.isNaN(p.challengeId));
}

function keyPair(p) {
    return `${p.userId}:${p.challengeId}`;
}

async function revertCompletion(userId, challengeId, { reopen }) {
    const uid = parseInt(userId, 10);
    const cid = normChallengeId(challengeId);
    if (cid == null) return { ok: false, reason: 'bad challenge id' };

    const user = await firebaseService.getUserById(uid);
    if (!user) return { ok: false, reason: 'user not found' };

    const challenge = await firebaseService.getChallengeById(cid);

    const completedRaw = Array.isArray(user.completedChallenges) ? user.completedChallenges : [];
    const completed = completedRaw.map((x) => normChallengeId(x)).filter((x) => x != null);
    const wasCompleted = completed.some((id) => id === cid);

    if (!wasCompleted) {
        console.warn(`  (skip) user ${uid} did not have challenge ${cid} in completedChallenges`);
        return { ok: true, user: uid, challenge: cid, wasCompleted: false, skipped: true };
    }

    const newCompleted = completed.filter((id) => id !== cid);

    const pt = challenge ? Math.max(_challengePoints(challenge), 0) : 0;
    const co2 = challenge ? Math.max(_challengeCo2(challenge), 0) : 0;

    if (!challenge) {
        console.warn(
            `  Challenge ${cid} not in database — removing completion only; points/CO₂/team not adjusted automatically.`
        );
    }

    let newPoints = user.points || 0;
    let newCo2 = user.totalCO2Saved || 0;
    if (challenge) {
        newPoints = Math.max(0, newPoints - pt);
        newCo2 = Math.max(0, newCo2 - co2);
    }

    let activeRaw = Array.isArray(user.activeChallenges) ? user.activeChallenges : [];
    let active = activeRaw.map((x) => normChallengeId(x)).filter((x) => x != null);
    if (reopen && challenge && !active.includes(cid)) {
        active = [...active, cid];
    }

    await firebaseService.updateUser(uid, {
        completedChallenges: newCompleted,
        activeChallenges: active,
        points: newPoints,
        totalCO2Saved: newCo2
    });

    if (user.teamId && challenge) {
        const team = await firebaseService.getTeamById(user.teamId);
        if (team) {
            const newTp = Math.max(0, (team.totalPoints || 0) - pt);
            await firebaseService.updateTeam(user.teamId, { totalPoints: newTp });
        }
    }

    return {
        ok: true,
        user: uid,
        challenge: cid,
        wasCompleted: true,
        subtractedPoints: challenge ? pt : 0,
        reopened: reopen,
        challengeMissing: !challenge
    };
}

function _challengePoints(ch) {
    return typeof ch.points === 'number' ? ch.points : parseFloat(ch.points) || 0;
}

function _challengeCo2(ch) {
    return typeof ch.co2Saved === 'number' ? ch.co2Saved : parseFloat(ch.co2Saved) || 0;
}

async function main() {
    const execute = process.argv.includes('--execute');
    const reopen = !process.argv.includes('--no-reopen');

    const allEvidence = await firebaseService.getAllEvidence();
    const fromDb = allEvidence
        .filter((e) => e.status === 'approved' && !isAiApprovedEvidence(e))
        .map((e) => ({
            userId: parseInt(e.userId, 10),
            challengeId: normChallengeId(e.challengeId),
            evidenceId: e.id
        }))
        .filter((p) => !Number.isNaN(p.userId) && p.challengeId != null);

    const fromArgs = parsePairsArg();

    const merged = new Map();
    for (const p of [...fromDb.map((x) => ({ userId: x.userId, challengeId: x.challengeId })), ...fromArgs]) {
        merged.set(keyPair(p), p);
    }
    const pairs = Array.from(merged.values());
    const evidenceToDelete = fromDb.map((x) => x.evidenceId).filter((id) => id != null);

    console.log(`Manual (non-AI) approved evidence rows in DB: ${fromDb.length}`);
    console.log(`Extra --pairs entries: ${fromArgs.length}`);
    console.log(`Unique user/challenge reverts: ${pairs.length}`);
    console.log(`Re-open challenges on active list: ${reopen}`);

    for (const p of pairs) {
        console.log(` - user ${p.userId} challenge ${p.challengeId}`);
    }

    if (!execute) {
        console.log('\nDry run. Pass --execute to apply reverts and delete DB evidence rows.');
        return;
    }

    for (const p of pairs) {
        const r = await revertCompletion(p.userId, p.challengeId, { reopen });
        console.log('Reverted:', r);
    }

    const seenIds = new Set();
    for (const id of evidenceToDelete) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        await firebaseService.deleteEvidence(id);
        console.log(`Deleted evidence id ${id}`);
    }

    console.log('Done.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
