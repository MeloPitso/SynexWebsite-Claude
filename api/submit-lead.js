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

  const { name, email, company, message } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const apiKey = (process.env.AIRTABLE_API_KEY || '').trim();
  const baseId = (process.env.AIRTABLE_BASE_ID || '').trim();
  const tableName = (process.env.AIRTABLE_TABLE_NAME || '').trim();

  if (!apiKey || !baseId || !tableName) {
    return res.status(500).json({ error: 'Server configuration error: missing Airtable credentials' });
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;

  let airtableRes;
  try {
    airtableRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          Name: name,
          Email: email,
          Company: company || '',
          Message: message || '',
        },
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach Airtable' });
  }

  if (!airtableRes.ok) {
    const body = await airtableRes.json().catch(() => ({}));
    return res.status(500).json({ error: 'Airtable rejected the record', details: body });
  }

  return res.status(200).json({ success: true });
};
