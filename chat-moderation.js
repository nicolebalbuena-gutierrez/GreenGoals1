/**
 * Server-side chat text moderation via OpenAI Moderation API.
 * Blocks flagged content before it is stored (general, team, and DM chat).
 * See: https://platform.openai.com/docs/guides/moderation
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

/**
 * @param {string} text - Raw message text (may be empty if image-only)
 * @returns {Promise<{ allowed: boolean, userMessage?: string }>}
 */
async function moderateChatText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        return { allowed: true };
    }

    const key = OPENAI_API_KEY && OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY_HERE' ? OPENAI_API_KEY : '';
    if (!key) {
        return { allowed: true };
    }

    try {
        const res = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                input: trimmed.slice(0, 8000)
            })
        });

        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.error('OpenAI moderation HTTP error:', res.status, errBody.slice(0, 200));
            return { allowed: true };
        }

        const data = await res.json();
        const result = data.results && data.results[0];
        if (!result) {
            return { allowed: true };
        }

        if (result.flagged) {
            const userMessage =
                'Your message was not sent. It may include hate, harassment, sexual content, threats, or other content that breaks our community guidelines. Please revise and try again.';
            return { allowed: false, userMessage, categories: result.categories };
        }

        return { allowed: true };
    } catch (e) {
        console.error('OpenAI moderation error:', e.message || e);
        return { allowed: true };
    }
}

module.exports = { moderateChatText };
