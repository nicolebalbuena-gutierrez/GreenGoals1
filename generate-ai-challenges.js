/**
 * OpenAI-powered challenge generation for GreenGoals
 * Generates college-student-friendly DAILY and WEEKLY challenges, diverse by category.
 * Runs on a cron schedule (every few days) or via admin API / npm script.
 */

require('dotenv').config();
const firebaseService = require('./firebase-service');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY_HERE';
const validCategories = ['Reduce', 'Nature', 'Transport', 'Food', 'Energy'];
const validDifficulties = ['Easy', 'Medium', 'Hard'];
const validCadence = ['daily', 'weekly'];

/** Skip challenges that are unrealistic for typical college students (e.g. planting trees, major landscaping). */
function isAbsurdCampusChallenge(name, description) {
    const t = `${name} ${description}`.toLowerCase();
    const banned = [
        'plant a tree',
        'plant trees',
        'planting a tree',
        'planting trees',
        'grow a tree',
        'backyard',
        'your yard',
        'orchard',
        'install solar',
        'buy an ev',
        'buy a hybrid',
        'purchase solar',
        'roof solar',
        'dig a garden',
        'start a farm',
        'buy acre',
        'plant a garden', // unless tiny indoor herb — too ambiguous; skip
        'reforest',
        'afforest'
    ];
    return banned.some((phrase) => t.includes(phrase));
}

/** Same notion as public API: not a pending admin draft and not hidden as unverifiable. */
function isVisibleToUsers(challenge) {
    if (!challenge) return false;
    if (challenge.aiApprovalStatus === 'pending_admin') return false;
    if (isNotPhotoVerifiable(String(challenge.name || ''), String(challenge.description || ''))) {
        return false;
    }
    return true;
}

function normalizeForDedupe(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^-a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function wordSetFromName(name) {
    return new Set(
        normalizeForDedupe(name)
            .split(' ')
            .filter((w) => w.length > 2)
    );
}

/**
 * True if this name/description is too close to something already live (users would see both).
 */
function isTooSimilarToExisting(name, description, existingVisible) {
    const n = normalizeForDedupe(name);
    if (n.length < 4) return false;
    const wordsNew = wordSetFromName(name);
    const descN = normalizeForDedupe(description).slice(0, 280);

    for (const ex of existingVisible) {
        const en = normalizeForDedupe(ex.name);
        if (!en) continue;

        if (n === en) return true;

        const minLen = Math.min(n.length, en.length);
        if (minLen >= 12 && (n.includes(en) || en.includes(n))) return true;

        if (wordsNew.size >= 3) {
            const wordsEx = wordSetFromName(ex.name);
            let inter = 0;
            for (const w of wordsNew) {
                if (wordsEx.has(w)) inter++;
            }
            const union = wordsNew.size + wordsEx.size - inter;
            if (union > 0 && inter / union >= 0.55) return true;
        }

        const descEx = normalizeForDedupe(ex.description || '').slice(0, 280);
        if (descN.length > 50 && descEx.length > 50 && descN === descEx) return true;
    }
    return false;
}

function buildExistingChallengesBlock(existingVisible) {
    if (!existingVisible.length) {
        return 'There are no live challenges in the app yet. You may create freely.';
    }
    const maxLines = 60;
    const lines = existingVisible.slice(0, maxLines).map((c) => {
        const desc = String(c.description || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        return `- [${c.category || '?'}] ${String(c.name || '').trim()} — ${desc}`;
    });
    let block = lines.join('\n');
    if (existingVisible.length > maxLines) {
        block += `\n… and ${existingVisible.length - maxLines} more (same rule applies).`;
    }
    return block;
}

/**
 * Users submit a PHOTO as proof. Reject challenges you cannot reasonably verify from one image.
 */
function isNotPhotoVerifiable(name, description) {
    const t = `${name} ${description}`.toLowerCase();
    const unverifiable = [
        'shower',
        'minute shower',
        'cold shower',
        'hot shower',
        'warmer shower', // still duration / private habit
        'cooler shower',
        'take shorter',
        'brush your teeth',
        'brush teeth',
        'think about',
        'remember to',
        'pledge to',
        'meditate',
        'no social media',
        'limit screen',
        'shorter shower',
        'reduce water',
        'use less water',
        'when you leave the room', // lights off habit — not one photo
        'always turn off'
    ];
    return unverifiable.some((phrase) => t.includes(phrase));
}

async function generateAICampaignChallenges() {
    const hasOpenAI = OPENAI_API_KEY && OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY_HERE';
    if (!hasOpenAI) {
        console.log('⚠️  OPENAI_API_KEY not set – skipping AI challenge generation');
        return { created: 0, error: 'OpenAI not configured' };
    }

    try {
        let allExisting = [];
        try {
            allExisting = await firebaseService.getAllChallenges();
        } catch (e) {
            console.warn('Could not load existing challenges for cross-reference:', e.message);
        }
        const existingVisible = allExisting.filter(isVisibleToUsers);
        const existingBlock = buildExistingChallengesBlock(existingVisible);

        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: `You create sustainability challenges for GreenGoals, an app for **college and university students**. Users **complete challenges by uploading a PHOTO** that proves they did the action — an AI checks the photo.

**NO DUPLICATES — cross-check against existing live challenges:**
- The user message includes a list of challenges **already live in the app**. Do **not** copy, lightly reword, or reuse the same core action / photo task as any of them.
- The **name** and **description** (especially the "Photo:" line) must be clearly **new angles**, not variants of an existing challenge.
- Reusing the same broad category (e.g. two different Food ideas) is fine; repeating the **same behavior** is not.

**CRITICAL — photo-verifiable only:**
- Every challenge MUST be something a student can prove with **one clear photo** (e.g. reusable mug at coffee bar, bike locked at rack, plant-based meal, recycling/compost sort, power strip off, laundry air-drying, tote at store, refill station bottle).
- **Do NOT** use: shower length/time, water-use habits you cannot see, brushing teeth, "turn off lights every time", vague pledges, or anything that only happens in private with no visible proof.
- In the **description**, end with a short line: **Photo: [what to upload]** so the student knows exactly what to photograph.

Return a JSON object: { "challenges": [ ... ] } with **exactly 6** challenges:

**3 DAILY challenges** (cadence: "daily"):
- A student can complete them **in one day** with normal college routines (no multi-day streak required inside the challenge text).
- duration examples: "1 day", "today", "1 evening" — keep them realistic for a busy student.
- difficulty: mostly **Easy**, can be one **Medium** if still same-day.
- points: 18–40. co2Saved: 0.3–4 kg.

**3 WEEKLY challenges** (cadence: "weekly"):
- Run about **5–7 days** of habit or repeated action (duration string like "5 days", "7 days", "1 week").
- difficulty: **Easy**, **Medium**, or **Hard** as fits; must still be **doable** without special gear, travel, or money (no solar panels, no "buy an EV", no things requiring a house/off-campus house).
- points: 35–95. co2Saved: 2–20 kg.

**Category diversity (required):**
- You MUST use these categories only: **Reduce**, **Nature**, **Transport**, **Food**, **Energy** (exact spelling).
- **Reduce** = waste, plastics, recycling, reuse, printing less, borrowing instead of buying, etc.
- Cover **all five categories at least once** across the 6 challenges; the sixth may repeat any category you already used.
- Do **not** put every challenge in one category — spread them.

**College-doable rules:**
- Assume shared dorms, meal plans, bus/bike/walk, library, gym, student center.
- Avoid: illegal acts, shaming, unrealistic purity tests, challenges needing a backyard, yard, or private car.
- **Never** suggest: planting trees, reforestation, large gardening, buying solar panels or electric vehicles, or anything that needs private land.
- For **Nature** on campus, use only realistic ideas: e.g. litter pickup on a campus path, lunch outside without litter, join an official campus cleanup or garden club event, notice local wildlife from public paths, leave green spaces cleaner than you found them.
- Descriptions: 1–2 clear sentences, action-oriented, encouraging.

Each item needs: name, description, category, difficulty, duration, co2Saved (number), points (number), cadence ("daily" or "weekly").`
                    },
                    {
                        role: 'user',
                        content: `Here are challenges **already live** in the app (users see these today):\n\n${existingBlock}\n\n---\n\nGenerate **6 brand-new** challenges: 3 daily and 3 weekly for college students. Maximize category diversity (Reduce including recycle/waste, Energy, Food, Transport, Nature). None of the six may duplicate or closely mirror any item in the list above.`
                    }
                ]
            })
        });

        if (!aiRes.ok) {
            const errText = await aiRes.text();
            console.error('OpenAI error:', aiRes.status, errText);
            return { created: 0, error: `OpenAI error: ${aiRes.status}` };
        }

        const aiJson = await aiRes.json();
        const content = aiJson.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);
        let challenges = Array.isArray(parsed.challenges) ? parsed.challenges : [];

        if (challenges.length !== 6) {
            console.warn(`AI returned ${challenges.length} challenges (expected 6); saving what we got.`);
        }

        let created = 0;
        let skipped = 0;
        let skippedDuplicate = 0;
        /** @type {Array<Record<string, unknown>>} */
        const createdThisRun = [];
        /** @type {Array<Record<string, unknown>>} */
        const createdChallenges = [];
        for (const c of challenges) {
            const name = String(c.name || 'Eco Challenge').trim();
            const description = String(c.description || 'Take action for the planet.').trim();
            if (isAbsurdCampusChallenge(name, description)) {
                console.warn(`⚠️  Skipped AI challenge (not college-realistic): ${name}`);
                skipped++;
                continue;
            }
            if (isNotPhotoVerifiable(name, description)) {
                console.warn(`⚠️  Skipped AI challenge (not photo-verifiable): ${name}`);
                skipped++;
                continue;
            }
            if (isTooSimilarToExisting(name, description, existingVisible)) {
                console.warn(`⚠️  Skipped AI challenge (too similar to existing live challenge): ${name}`);
                skippedDuplicate++;
                skipped++;
                continue;
            }
            if (isTooSimilarToExisting(name, description, createdThisRun)) {
                console.warn(`⚠️  Skipped AI challenge (duplicate within this batch): ${name}`);
                skippedDuplicate++;
                skipped++;
                continue;
            }

            const category = validCategories.includes(c.category) ? c.category : 'Reduce';
            const difficulty = validDifficulties.includes(c.difficulty) ? c.difficulty : 'Medium';
            const cadenceRaw = String(c.cadence || '').toLowerCase();
            const cadence = validCadence.includes(cadenceRaw) ? cadenceRaw : 'daily';

            const challengeData = {
                name,
                description,
                category,
                difficulty,
                duration: String(c.duration || (cadence === 'weekly' ? '7 days' : '1 day')).trim(),
                co2Saved: typeof c.co2Saved === 'number' ? Math.max(0.1, c.co2Saved) : 1,
                points: typeof c.points === 'number' ? Math.max(15, Math.min(100, c.points)) : 25,
                cadence,
                aiGenerated: true,
                aiApprovalStatus: 'pending_admin',
                createdAt: new Date().toISOString()
            };
            const saved = await firebaseService.createChallenge(challengeData);
            createdChallenges.push(saved);
            createdThisRun.push({
                name: challengeData.name,
                description: challengeData.description,
                category: challengeData.category
            });
            created++;
            console.log(`✅ AI draft saved (pending admin) [${challengeData.cadence}]: ${challengeData.name} (${challengeData.category})`);
        }

        return { created, skipped, skippedDuplicate, challenges: createdChallenges };
    } catch (error) {
        console.error('Error generating AI challenges:', error);
        return { created: 0, error: error.message };
    }
}

if (require.main === module) {
    (async () => {
        console.log('🌱 Generating AI challenges (daily + weekly, college-focused)...');
        const result = await generateAICampaignChallenges();
        console.log(`Done. Saved ${result.created} draft(s) for admin review (not yet visible to users).`);
        if (result.error) console.error('Error:', result.error);
        process.exit(result.error ? 1 : 0);
    })();
}

module.exports = {
    generateAICampaignChallenges,
    isNotPhotoVerifiable,
    isAbsurdCampusChallenge,
    isVisibleToUsers,
    isTooSimilarToExisting
};
