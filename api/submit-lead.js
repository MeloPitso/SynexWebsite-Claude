const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
      ? `Hey ${name}, great to hear from you.\n\nWe understand that finding the right solution isn't always straightforward — and that's completely okay.\n\nOne of our team members will reach out to you personally to understand your business, your goals, and the challenges you're facing. From there, we'll guide you towards the right solution tailored specifically to your needs.\n\nYou're in good hands.\n\nSynex AI Labs`
      : `Hey ${name}, great to hear from you.\n\nWe've received your enquiry about ${service} and one of our team members will be in touch within 24 hours.\n\nWe look forward to showing you what's possible.\n\nSynex AI Labs`;

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
