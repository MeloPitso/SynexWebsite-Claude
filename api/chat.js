const SYSTEM_PROMPT = `You are the AI assistant for Synex AI Labs, an AI automation agency based in Cape Town, South Africa. Your job is to answer questions about the agency's services and qualify potential leads.

Be sharp, direct, and confident. No filler phrases. No "Great question!" No "Certainly!" Just answer and move the conversation forward.

SERVICES YOU REPRESENT:
1. Speed to Lead System — captures every lead a business receives, scores it instantly, sends a personalised response, notifies the team, and runs an automated follow-up sequence for up to 14 days. Stops the moment contact is made. Built for any service business that generates leads.
2. Database Reactivation — re-engages a business's cold or dormant contacts automatically. Upload a list, the system personalises and sends a reactivation sequence, flags responses, and notifies the team. Built for businesses sitting on contacts they have never followed up properly.
3. Agentic Workflows — custom AI systems built for complex, multi-step operations. The AI receives a goal, determines the steps, uses the right tools, and delivers an outcome. Built for businesses where the process is too variable or too high-stakes for standard automation.

QUALIFICATION FLOW:
When someone shows buying intent — asking about pricing, wanting to get started, asking how it works for their business — collect the following in a natural conversational way, one at a time. Do not ask all at once:
1. Their name
2. Their email address
3. Their company name
4. What they are looking to automate or solve

Once you have all four, tell them: "Perfect. Someone from the Synex AI Labs team will be in touch with you shortly." Then trigger the lead capture.

RULES:
- Never mention tool names (no n8n, Airtable, Claude, Resend, etc.)
- Never make up pricing — if asked, say pricing depends on the scope and starts with a free audit
- Never go off topic. If someone asks something unrelated, bring it back.
- Keep responses short — 2 to 4 sentences maximum unless a detailed explanation is genuinely needed
- If someone is clearly not a potential client, politely end the conversation`;

const CAPTURE_LEAD_TOOL = {
  name: 'capture_lead',
  description: "Call this tool once you have collected the prospect's name, email address, company name, and what they are looking to automate or solve. Only call this once per conversation, immediately after telling them someone will be in touch.",
  input_schema: {
    type: 'object',
    properties: {
      name:           { type: 'string', description: 'Full name of the prospect' },
      email:          { type: 'string', description: 'Email address of the prospect' },
      company:        { type: 'string', description: 'Company or business name' },
      what_they_need: { type: 'string', description: 'What they are looking to automate or solve' },
    },
    required: ['name', 'email', 'company', 'what_they_need'],
  },
};

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

  const { messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    console.error('[chat] ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in environment variables' });
  }

  /* Sanitise messages: keep only user/assistant turns with string content.
     Consecutive same-role messages are collapsed to avoid API errors. */
  const sanitised = [];
  for (const m of messages) {
    if (!m || !m.content || typeof m.content !== 'string') continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (sanitised.length > 0 && sanitised[sanitised.length - 1].role === role) {
      sanitised[sanitised.length - 1].content += '\n' + m.content;
    } else {
      sanitised.push({ role, content: m.content });
    }
  }

  if (sanitised.length === 0 || sanitised[sanitised.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Conversation must end with a user message' });
  }

  let apiRes;
  try {
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     SYSTEM_PROMPT,
        messages:   sanitised,
        tools:      [CAPTURE_LEAD_TOOL],
      }),
    });
  } catch (err) {
    console.error('[chat] fetch to Anthropic failed', err.message);
    return res.status(500).json({ error: 'Failed to reach AI service' });
  }

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error('[chat] Anthropic API error', apiRes.status, errText.slice(0, 400));
    return res.status(500).json({ error: 'AI service returned an error' });
  }

  const data = await apiRes.json();

  let message = '';
  let leadCapture = null;

  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text' && !message) {
        message = block.text;
      }
      if (block.type === 'tool_use' && block.name === 'capture_lead' && !leadCapture) {
        leadCapture = block.input;
      }
    }
  }

  /* Fallback message if the model only returned a tool call */
  if (!message && data.stop_reason === 'tool_use') {
    message = 'Perfect. Someone from the Synex AI Labs team will be in touch with you shortly.';
  }

  if (!message) {
    message = 'Something went wrong on my end. Please try again.';
  }

  return res.status(200).json({ message, leadCapture });
};
