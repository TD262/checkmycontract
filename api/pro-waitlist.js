import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://checkmycontract.co');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const rateLimitKey = `pro-waitlist:ip:${ip}`;
  const requests = await redis.incr(rateLimitKey);
  if (requests === 1) await redis.expire(rateLimitKey, 3600);
  if (requests > 5) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { email, feedback } = req.body;
  const normalizedEmail = (email || '').toLowerCase().trim();

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    // Check if already on Pro waitlist
    const checkRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/pro_waitlist?email=eq.${encodeURIComponent(normalizedEmail)}&select=email&limit=1`,
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );
    const existing = await checkRes.json();

    if (existing && existing.length > 0) {
      return res.status(200).json({ message: 'Already on the Pro waitlist.' });
    }

    // Insert into pro_waitlist table
    const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/pro_waitlist`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        email: normalizedEmail,
        feedback: feedback || null,
        created_at: new Date().toISOString()
      })
    });

    if (!insertRes.ok) {
      throw new Error('Insert failed');
    }

    return res.status(200).json({ message: 'Added to Pro waitlist.' });

  } catch(err) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}