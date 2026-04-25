export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://checkmycontract.co');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    // Check if email already on waitlist
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=email`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const existing = await checkRes.json();

    if (existing.length > 0) {
      return res.status(200).json({ message: 'Already on the list.' });
    }

    // Add to waitlist
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        email: email,
        checks_used: 0,
        period_start: new Date().toISOString(),
        approved: false
      })
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      throw new Error(err);
    }

    return res.status(200).json({ message: 'Added to waitlist.' });

  } catch(err) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}