const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { name, email, company, what_they_need } = body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  console.log('[chat-lead-capture] processing lead', { name, email, company: company || '—' });

  const results = {};

  /* ── AIRTABLE ─────────────────────────────────────────────────── */

  const airtableKey  = (process.env.AIRTABLE_API_KEY || '').trim();
  const airtableBase = (process.env.AIRTABLE_BASE_ID || '').trim();
  const airtableTable = 'Leads';

  if (airtableKey) {
    try {
      const atRes = await fetch(
        `https://api.airtable.com/v0/${airtableBase}/${encodeURIComponent(airtableTable)}`,
        {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${airtableKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: {
              Name:              name,
              Email:             email,
              'Company Name':    company        || '',
              'What They Need':  what_they_need || '',
              Source:            'Website Chatbot',
            },
          }),
        }
      );

      results.airtable = atRes.ok ? 'ok' : `error ${atRes.status}`;

      if (!atRes.ok) {
        const t = await atRes.text();
        console.error('[chat-lead-capture] Airtable error', atRes.status, t.slice(0, 400));
      } else {
        console.log('[chat-lead-capture] Airtable record created');
      }
    } catch (err) {
      console.error('[chat-lead-capture] Airtable threw', err.message);
      results.airtable = 'threw';
    }
  } else {
    console.warn('[chat-lead-capture] AIRTABLE_API_KEY not set — skipping');
    results.airtable = 'skipped';
  }

  /* ── TELEGRAM ─────────────────────────────────────────────────── */

  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId   = (process.env.TELEGRAM_CHAT_ID   || '').trim();

  if (botToken && chatId) {
    const tgText = [
      'New lead from website chatbot',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Company: ${company        || '—'}`,
      `Needs: ${what_they_need  || '—'}`,
    ].join('\n');

    try {
      const tgRes  = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: tgText }),
      });
      const tgData = await tgRes.json();
      results.telegram = tgData.ok ? 'ok' : 'error';
      if (!tgData.ok) console.error('[chat-lead-capture] Telegram error', tgData);
      else console.log('[chat-lead-capture] Telegram notification sent');
    } catch (err) {
      console.error('[chat-lead-capture] Telegram threw', err.message);
      results.telegram = 'threw';
    }
  } else {
    console.warn('[chat-lead-capture] Telegram credentials not set — skipping');
    results.telegram = 'skipped';
  }

  /* ── RESEND ───────────────────────────────────────────────────── */

  const resendKey = (process.env.RESEND_API_KEY || '').trim();

  if (resendKey) {
    const emailText =
      `Hi ${name},\n\n` +
      `Thanks for reaching out. Someone from the Synex AI Labs team will be in touch with you within 24 hours.\n\n` +
      `In the meantime, you can explore what we do at synexailabs.com.\n\n` +
      `— Synex AI Labs`;

    try {
      const resend = new Resend(resendKey);
      const { error: sendError } = await resend.emails.send({
        from:    'admin@synexailabs.com',
        to:      email,
        subject: "We'll be in touch shortly — Synex AI Labs",
        text:    emailText,
      });
      results.resend = sendError ? 'error' : 'ok';
      if (sendError) console.error('[chat-lead-capture] Resend error', sendError);
      else console.log('[chat-lead-capture] confirmation email sent to', email);
    } catch (err) {
      console.error('[chat-lead-capture] Resend threw', err.message);
      results.resend = 'threw';
    }
  } else {
    console.warn('[chat-lead-capture] RESEND_API_KEY not set — skipping');
    results.resend = 'skipped';
  }

  return res.status(200).json({ success: true, results });
};
