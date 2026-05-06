export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://checkmycontract.co');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const token = authHeader.replace('Bearer ', '');

  // Verify token with Supabase and get email
  const sessionRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`
    }
  });

  if (!sessionRes.ok) {
    return res.status(401).json({ error: 'Invalid session.' });
  }

  const sessionData = await sessionRes.json();
  const email = (sessionData.email || '').toLowerCase().trim();

  if (!email) {
    return res.status(401).json({ error: 'Could not verify identity.' });
  }

  // Check if profile already exists
  const checkRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=email&limit=1`,
    {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    }
  );
  const existing = await checkRes.json();

  if (existing && existing.length > 0) {
    return res.status(200).json({ message: 'Profile already exists.' });
  }

  // Insert new profile with approved = true
  const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles`, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      email: email,
      approved: true,
      checks_used: 0,
      period_start: new Date().toISOString()
    })
  });

  if (!insertRes.ok) {
    return res.status(500).json({ error: 'Could not create profile.' });
  }

  return res.status(200).json({ message: 'Profile created.' });
}