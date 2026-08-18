const { Resend } = require('resend');

/* ── CORS ────────────────────────────────────────────────────────────────────
 * Only the real site may post here. The apex domain 301s to www, so both are
 * listed; localhost is kept for local development against serve.mjs.
 * Note this is enforced server-side (403), not merely advertised in headers —
 * CORS headers alone are a browser-side convention and would not stop a script.
 */
const ALLOWED_ORIGINS = [
  'https://synexailabs.com',
  'https://www.synexailabs.com',
  'http://localhost:3000',
];

/* ── RATE LIMIT ──────────────────────────────────────────────────────────────
 * 5 submissions per IP per 10 minutes. A real enquirer submits once, twice if
 * they typo — 5 leaves generous headroom while stopping scripted floods, and a
 * 10-minute window means anyone who does trip it recovers quickly.
 *
 * This is in-memory and therefore PER WARM INSTANCE. Vercel runs several
 * concurrent instances and recycles them, so a determined distributed attacker
 * can still get through; this is a speed bump, not a guarantee. That trade is
 * deliberate: this form takes a handful of submissions a week, so a durable
 * store (Vercel KV / Upstash) would add a dependency and an external round-trip
 * per request for little real gain. If volume or abuse grows, swap the Map for
 * a KV-backed counter — the checkRateLimit() signature is designed for that.
 */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateLimitHits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateLimitHits.get(ip) || []).filter(t => t > cutoff);

  // Opportunistic sweep so a long-lived warm instance can't grow unbounded.
  if (rateLimitHits.size > 5000) {
    for (const [key, times] of rateLimitHits) {
      if (!times.some(t => t > cutoff)) rateLimitHits.delete(key);
    }
  }

  if (hits.length >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((hits[0] + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }

  hits.push(now);
  rateLimitHits.set(ip, hits);
  return { allowed: true };
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  const originAllowed = !!origin && ALLOWED_ORIGINS.includes(origin);

  if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(originAllowed ? 200 : 403).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Browsers always send Origin on a cross-site POST, and same-origin fetch()
  // sends it too — so a missing Origin here means a non-browser client. This
  // endpoint only ever serves the site's own contact form, so reject both.
  if (!originAllowed) {
    console.warn('[submit-lead] rejected disallowed origin', { origin: origin || '(none)' });
    return res.status(403).json({ error: 'Forbidden' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';

  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    console.warn('[submit-lead] rate limit exceeded', { ip, retryAfter: limit.retryAfter });
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });
  }

  // Vercel auto-parses JSON bodies, but handle raw string as a safety net
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { name, email, company, service, message } = body;

  console.log('[submit-lead] request received', {
    method: req.method,
    hasBody: !!req.body,
    bodyType: typeof req.body,
    hasName: !!name,
    hasEmail: !!email,
  });

  if (!name || !email) {
    console.log('[submit-lead] validation failed — missing name or email');
    return res.status(400).json({ error: 'Name and email are required' });
  }

  // ── AIRTABLE ────────────────────────────────────────────────────────────────

  const apiKey    = (process.env.AIRTABLE_API_KEY    || '').trim();
  const baseId    = (process.env.AIRTABLE_BASE_ID    || '').trim();
  const tableName = (process.env.AIRTABLE_TABLE_NAME || '').trim();

  console.log('[submit-lead] env vars', {
    hasApiKey:    !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.slice(0, 10) + '…' : 'MISSING',
    baseId:       baseId    || 'MISSING',
    tableName:    tableName || 'MISSING',
  });

  if (!apiKey || !baseId || !tableName) {
    console.error('[submit-lead] missing Airtable credentials — check Vercel env vars');
    return res.status(500).json({ error: 'Server configuration error: missing Airtable credentials' });
  }

  const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;

  const payload = {
    fields: {
      Name:    name,
      Email:   email,
      Company: company || '',
      Service: service || '',
      Message: message || '',
      Date:    new Date().toISOString().split('T')[0],
      Status:  'New',
    },
  };

  console.log('[submit-lead] posting to Airtable', { airtableUrl, fieldKeys: Object.keys(payload.fields) });

  let airtableRes;
  try {
    airtableRes = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[submit-lead] fetch threw an exception', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Failed to reach Airtable', detail: err.message });
  }

  const rawBody = await airtableRes.text();
  console.log('[submit-lead] Airtable response', {
    status:  airtableRes.status,
    ok:      airtableRes.ok,
    rawBody: rawBody.slice(0, 500),
  });

  if (!airtableRes.ok) {
    let parsed = {};
    try { parsed = JSON.parse(rawBody); } catch { /* leave as {} */ }
    console.error('[submit-lead] Airtable rejected the record', parsed);
    return res.status(500).json({
      error:   'Airtable rejected the record',
      status:  airtableRes.status,
      details: parsed,
    });
  }

  console.log('[submit-lead] record saved successfully');

  // ── RESEND EMAIL CONFIRMATION ────────────────────────────────────────────────

  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendKey) {
    const isGeneral = service === 'Not sure / General Enquiry';

    const emailText = isGeneral
      ? `Hey ${name}, great to hear from you.\n\nWe understand that finding the right solution isn't always straightforward — and that's completely okay.\n\nOne of our team members will reach out to you personally to understand your business, your goals, and the challenges you're facing. From there, we'll guide you towards the right solution tailored specifically to your needs.\n\nYou're in good hands.\n\nRegards,\nSynex AI Labs`
      : `Hey ${name}, great to hear from you.\n\nWe've received your enquiry about ${service} and one of our team members will be in touch within 24 hours.\n\nWe look forward to showing you what's possible.\n\nRegards,\nSynex AI Labs`;

    try {
      const resend = new Resend(resendKey);
      const { error: sendError } = await resend.emails.send({
        from:    'admin@synexailabs.com',
        to:      email,
        subject: "We've received your enquiry — Synex AI Labs",
        text:    emailText,
      });
      if (sendError) {
        console.error('[submit-lead] Resend returned an error', sendError);
      } else {
        console.log('[submit-lead] confirmation email sent to', email);
      }
    } catch (err) {
      console.error('[submit-lead] Resend threw an exception', err.message);
    }
  } else {
    console.warn('[submit-lead] RESEND_API_KEY not set — skipping email');
  }

  // ── TELEGRAM NOTIFICATION ────────────────────────────────────────────────────

  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId   = (process.env.TELEGRAM_CHAT_ID   || '').trim();

  if (botToken && chatId) {
    const timestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    const tgText = [
      '🔔 New Lead — Synex AI Labs',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Company: ${company || '—'}`,
      `Service: ${service || '—'}`,
      `Message: ${message || '—'}`,
      `Time: ${timestamp}`,
    ].join('\n');

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: tgText }),
      });
      const tgData = await tgRes.json();
      if (tgData.ok) {
        console.log('[submit-lead] Telegram notification sent');
      } else {
        console.error('[submit-lead] Telegram API error', tgData);
      }
    } catch (err) {
      console.error('[submit-lead] Telegram threw an exception', err.message);
    }
  } else {
    console.warn('[submit-lead] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping notification');
  }

  return res.status(200).json({ success: true });
};
