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

  const { name, email, company, message } = body;

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

  const apiKey   = (process.env.AIRTABLE_API_KEY    || '').trim();
  const baseId   = (process.env.AIRTABLE_BASE_ID    || '').trim();
  const tableName = (process.env.AIRTABLE_TABLE_NAME || '').trim();

  console.log('[submit-lead] env vars', {
    hasApiKey:      !!apiKey,
    apiKeyPrefix:   apiKey   ? apiKey.slice(0, 10) + '…'  : 'MISSING',
    baseId:         baseId   || 'MISSING',
    tableName:      tableName || 'MISSING',
  });

  if (!apiKey || !baseId || !tableName) {
    console.error('[submit-lead] missing Airtable credentials — check Vercel env vars');
    return res.status(500).json({ error: 'Server configuration error: missing Airtable credentials' });
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;

  const payload = {
    fields: {
      Name:    name,
      Email:   email,
      Company: company || '',
      Message: message || '',
      Date:    new Date().toISOString(),
      Status:  'New',
    },
  };

  console.log('[submit-lead] posting to Airtable', { url, fieldKeys: Object.keys(payload.fields) });

  let airtableRes;
  try {
    airtableRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[submit-lead] fetch threw an exception', {
      message: err.message,
      stack:   err.stack,
    });
    return res.status(500).json({ error: 'Failed to reach Airtable', detail: err.message });
  }

  // Read as text first so we never crash on non-JSON error bodies (rate limits, etc.)
  const rawBody = await airtableRes.text();
  console.log('[submit-lead] Airtable response', {
    status:  airtableRes.status,
    ok:      airtableRes.ok,
    rawBody: rawBody.slice(0, 500),   // cap at 500 chars so logs stay readable
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
  return res.status(200).json({ success: true });
};
