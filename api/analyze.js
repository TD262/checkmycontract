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

    const prompt = 'You are an expert contract analyst for freelancers. Analyze this contract and identify risks, red flags, and positive terms.\n\nContract:\n' + contractText.substring(0, 6000) + '\n\nRespond with ONLY valid JSON (no markdown, no backticks, no extra text):\n{"riskScore":<0-100>,"riskLevel":"<Low|Medium|High|Critical>","riskColor":"<#10b981|#f59e0b|#ef4444|#dc2626>","summary":"<2-3 sentence plain English overview>","findings":[{"type":"<critical|warning|positive|info>","icon":"<emoji>","title":"<short title>","description":"<plain English for freelancer>","quote":"<excerpt or empty string>"}],"questions":["<question for client>","<question>","<question>"]}';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}