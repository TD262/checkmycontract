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

  const ALLOWED_EMAIL = 'tdd26294@gmail.com';
  if (email && email.toLowerCase() !== ALLOWED_EMAIL) {
    return res.status(401).json({ error: 'Access not authorized.' });
  }
  
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  try {
    // Look up this email in the database
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const users = await lookupRes.json();
    const now = new Date();

    if (users.length === 0) {
      // Brand new user — insert them with 0 checks used
      await fetch(`${SUPABASE_URL}/rest/v1/users`, {
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
          period_start: now.toISOString()
        })
      });

      // Send welcome email via Resend
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'CheckMyContract <hello@checkmycontract.co>',
          to: email,
          subject: 'Your contract analysis is ready 📄',
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a2e;">
              <h2 style="font-size:22px;margin-bottom:8px;">Welcome to CheckMyContract</h2>
              <p style="color:#5a6a8a;line-height:1.6;">You've just used your 1 free contract check for this month. Your results are ready in the app.</p>
              <p style="color:#5a6a8a;line-height:1.6;">Need to review more contracts? Upgrade to Pro for unlimited checks.</p>
              <a href="https://checkmycontract.co" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#0f1f3d;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Go Pro — $19/mo</a>
              <p style="margin-top:32px;font-size:12px;color:#aaa;">CheckMyContract · Not legal advice</p>
            </div>
          `
        })
      });

      return res.status(200).json({ allowed: true, checksRemaining: 0 });

    } else {
      const user = users[0];
      const periodStart = new Date(user.period_start);

      // Check if a full calendar month has passed — if so, reset their count
      const monthsElapsed =
        (now.getFullYear() - periodStart.getFullYear()) * 12 +
        (now.getMonth() - periodStart.getMonth());

      if (monthsElapsed >= 1) {
        // Reset their monthly count
        await fetch(
          `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              checks_used: 0,
              period_start: now.toISOString()
            })
          }
        );
        return res.status(200).json({ allowed: true, checksRemaining: 0 });
      }

      // Still within the same month — check if they've used their free check
      if (user.checks_used >= 1) {
        return res.status(200).json({
          allowed: false,
          checksRemaining: 0,
          message: "You've used your free check for this month. Upgrade to Pro for unlimited reviews."
        });
      }

      // They still have their free check — allow it
      return res.status(200).json({ allowed: true, checksRemaining: 0 });
    }

  } catch (err) {
    return res.status(500).json({ error: 'Database error: ' + err.message });
  }
}