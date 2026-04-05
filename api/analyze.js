import formidable from 'formidable';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    let contractText = '';

    const uploadedFile = files.file ? files.file[0] : null;

    if (uploadedFile) {
      const ext = uploadedFile.originalFilename.split('.').pop().toLowerCase();
      const buffer = fs.readFileSync(uploadedFile.filepath);

      if (ext === 'pdf') {
        const parsed = await pdfParse(buffer);
        contractText = parsed.text;
      } else if (ext === 'docx' || ext === 'doc') {
        const result = await mammoth.extractRawText({ buffer });
        contractText = result.value;
      } else if (ext === 'txt') {
        contractText = buffer.toString('utf-8');
      } else {
        return res.status(400).json({ error: 'Unsupported file type.' });
      }
    } else if (fields.prompt) {
      contractText = Array.isArray(fields.prompt) ? fields.prompt[0] : fields.prompt;
    }

    if (!contractText || contractText.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract text from this file. Please try a different file or paste the text directly.' });
    }

    const isProUser = false; // will be true when Stripe is set up
const charLimit = isProUser ? 15000 : 6000;

const prompt = `You are an expert contract analyst specializing in freelance agreements. Your job is to protect freelancers from unfair, exploitative, and dangerous contract terms.

Analyze this contract thoroughly and identify ALL risks, red flags, positive terms, and negotiation opportunities. Be specific, direct, and speak plainly to a freelancer who has no legal background.

Contract:
${contractText.substring(0, charLimit)}

You MUST check every single one of these areas and report on each one you find:
- Payment terms (amount, schedule, late fees, kill fees, deposit)
- Revision policy (number of revisions, what counts as a revision, scope creep risk)
- Intellectual property ownership (who owns the work, when ownership transfers)
- Non-compete clause (restrictions on future work, duration, scope)
- Non-solicitation clause (restrictions on working with client's contacts)
- Confidentiality (what you can't share, for how long)
- Termination rights (who can cancel, how much notice, what happens to payment)
- Liability and indemnification (who is responsible if something goes wrong)
- Dispute resolution (how disagreements are handled, which state's laws apply)
- Governing law and jurisdiction (where legal action must take place)
- Payment on completion vs milestones (risk of non-payment)
- Unlimited revisions or vague scope (risk of endless unpaid work)
- Exclusivity clauses (restrictions on working with other clients)

For each finding:
- Explain exactly how it affects the freelancer's money, career, or freedom
- Quantify the risk where possible (e.g. "this could cost you the entire project fee")
- Give a specific negotiation suggestion — the exact change they should ask for
- Quote the exact clause from the contract where possible

You MUST return a minimum of 8 findings. If the contract is short, dig deeper. If a clause is missing entirely, flag that as a risk too.

Respond with ONLY valid JSON (no markdown, no backticks, no extra text):
{"riskScore":<0-100>,"riskLevel":"<Low|Medium|High|Critical>","riskColor":"<#10b981|#f59e0b|#ef4444|#dc2626>","summary":"<3-4 sentence plain English overview that tells the freelancer exactly what kind of contract this is and what their biggest risks are>","findings":[{"type":"<critical|warning|positive|info>","icon":"<emoji>","title":"<short title>","description":"<2-3 sentence plain English explanation of the risk and exactly how it affects the freelancer>","quote":"<exact clause from contract or empty string>","negotiate":"<exact wording the freelancer should ask for instead>"}],"questions":["<specific question to ask client>","<specific question>","<specific question>","<specific question>","<specific question>"]}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    // Increment the check count in Supabase for this email
    const email = fields.email ? (Array.isArray(fields.email) ? fields.email[0] : fields.email) : null;
    if (email) {
      // Increment check count in Supabase
      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ checks_used: 1 })
        }
      );

      // Parse the analysis result so we can use it in the email
      const analysisText = data.content.map(b => b.text || '').join('');
      const cleanJson = analysisText.replace(/```json|```/g, '').trim();
      const result = JSON.parse(cleanJson);

      // Build findings HTML
      const typeColors = { critical: '#ef4444', warning: '#f59e0b', positive: '#10b981', info: '#0d9e8e' };
      const findingsHtml = (result.findings || []).map(f => `
        <div style="margin-bottom:16px;padding:16px 20px;background:#f9f9f9;border-radius:8px;border-left:4px solid ${typeColors[f.type] || '#0d9e8e'};">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${typeColors[f.type] || '#0d9e8e'};margin-bottom:4px;">${f.type}</div>
          <div style="font-size:15px;font-weight:600;color:#0f1f3d;margin-bottom:6px;">${f.title}</div>
          <div style="font-size:13px;color:#5a6a8a;line-height:1.6;">${f.description}</div>
          ${f.quote ? `<div style="margin-top:10px;padding:8px 12px;background:#f0ece4;border-radius:6px;font-size:12px;color:#5a6a8a;font-style:italic;">"${f.quote}"</div>` : ''}
        </div>
      `).join('');

      // Build questions HTML
      const questionsHtml = (result.questions || []).map((q, i) => `
        <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f0ece4;align-items:flex-start;">
          <div style="min-width:24px;height:24px;background:#0f1f3d;color:#fff;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</div>
          <div style="font-size:13px;color:#1a1a2e;line-height:1.5;">${q}</div>
        </div>
      `).join('');

      // Score color
      const scoreColor = result.riskColor || '#ef4444';

      // Send email via Resend
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'CheckMyContract <hello@checkmycontract.co>',
          to: email,
          subject: `Your Contract Report — ${result.riskLevel || 'Medium'} Risk`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;">

              <!-- Header -->
              <div style="background:#0f1f3d;padding:28px 32px;border-radius:12px 12px 0 0;">
                <div style="font-size:20px;font-weight:700;color:#fff;">CheckMyContract</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px;">AI-Powered Contract Review · Not legal advice</div>
              </div>

              <!-- Risk score -->
              <div style="background:#f0ece4;padding:24px 32px;display:flex;align-items:center;gap:20px;">
                <div style="width:64px;height:64px;border-radius:50%;border:4px solid ${scoreColor};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#0f1f3d;flex-shrink:0;">${result.riskScore}</div>
                <div>
                  <div style="font-size:18px;font-weight:700;color:#0f1f3d;">${result.riskLevel} Risk Contract</div>
                  <div style="font-size:13px;color:#5a6a8a;margin-top:4px;">
                    <span style="color:#ef4444;font-weight:600;">${(result.findings||[]).filter(f=>f.type==='critical').length} Critical</span> &nbsp;
                    <span style="color:#f59e0b;font-weight:600;">${(result.findings||[]).filter(f=>f.type==='warning').length} Warnings</span> &nbsp;
                    <span style="color:#10b981;font-weight:600;">${(result.findings||[]).filter(f=>f.type==='positive').length} Positive</span>
                  </div>
                </div>
              </div>

              <div style="padding:28px 32px;">

                <!-- Summary -->
                <div style="margin-bottom:28px;">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#5a6a8a;margin-bottom:10px;">Plain English Summary</div>
                  <div style="font-size:14px;color:#1a1a2e;line-height:1.7;padding:16px;background:#faf8f4;border-radius:8px;">${result.summary}</div>
                </div>

                <!-- Findings -->
                <div style="margin-bottom:28px;">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#5a6a8a;margin-bottom:10px;">Detailed Findings</div>
                  ${findingsHtml}
                </div>

                <!-- Questions -->
                <div style="margin-bottom:28px;">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#5a6a8a;margin-bottom:10px;">Questions to Ask Your Client</div>
                  ${questionsHtml}
                </div>

                <!-- Disclaimer -->
                <div style="padding:14px 18px;background:#fffbeb;border:1px solid rgba(245,166,35,0.3);border-radius:8px;font-size:12px;color:#5a6a8a;line-height:1.6;">
                  <strong>Not legal advice.</strong> This analysis is for informational purposes only and does not constitute legal advice. For important legal decisions, please consult a licensed attorney.
                </div>

              </div>

              <!-- Footer -->
              <div style="background:#f0ece4;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">
                <div style="font-size:12px;color:#5a6a8a;">CheckMyContract.co · <a href="https://checkmycontract.co" style="color:#0d9e8e;">Visit site</a></div>
              </div>

            </div>
          `
        })
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}