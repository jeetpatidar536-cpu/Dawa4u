// Vision AI prescription scanner, using the Claude API.
// Needs ANTHROPIC_API_KEY in .env. The key stays on the server and is never sent to the apps.

function prompt(products) {
  return `You are reading a photo of a medical prescription from India for a pharmacy delivery app. It may be handwritten, in English or Hindi.
Transcribe only what is actually written. Never guess a medicine you cannot read: set "confident" to false instead.
Reply with JSON only, no other text, in this shape:
{"is_prescription":true,"doctor":"name or null","date":"as written or null","medicines":[{"name":"medicine name","strength":"e.g. 500 mg or null","dosage":"e.g. 1-0-1 for 5 days or null","quantity":1,"confident":true,"product_id":"id or null"}]}
"quantity" is the number of packs to supply (integer, 1 if unclear). "product_id" is the id of a catalogue item only when it is the same medicine and the same strength, otherwise null.
If the photo is not a prescription, reply {"is_prescription":false,"medicines":[]}.
Catalogue:
${products.map(p => `${p.id} = ${p.name} (${p.pack})`).join('\n')}`;
}

async function readPrescription(imageBuffer, mediaType, products) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('The AI scanner is not set up. Add ANTHROPIC_API_KEY to the server .env file.'); e.status = 503; throw e; }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
        { type: 'text', text: prompt(products) },
      ] }],
    }),
  });
  if (!res.ok) {
    console.error('[ai] Claude API error', res.status, (await res.text()).slice(0, 300));
    const e = new Error(res.status === 429 ? 'Too many scans right now. Try again in a minute.' : 'The AI scanner could not read the photo. Try again.');
    e.status = 502; throw e;
  }
  const out = await res.json();
  const text = (out.content || []).map(c => c.text || '').join('');
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const ids = new Set(products.map(p => p.id));
  return {
    isPrescription: !!j.is_prescription,
    doctor: j.doctor || null,
    date: j.date || null,
    meds: (j.medicines || []).filter(m => m && m.name).slice(0, 20).map(m => ({
      name: String(m.name).slice(0, 80),
      strength: m.strength ? String(m.strength).slice(0, 30) : '',
      dosage: m.dosage ? String(m.dosage).slice(0, 60) : '',
      qty: Math.min(10, Math.max(1, parseInt(m.quantity) || 1)),
      confident: m.confident !== false,
      productId: ids.has(m.product_id) ? m.product_id : null,
    })),
  };
}

module.exports = { readPrescription };
