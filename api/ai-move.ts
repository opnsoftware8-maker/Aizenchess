import { processAiMoveRequest } from '../lib/ai-move-service';

export default async function handler(req: any, res: any) {
  if (!res || typeof res.status !== 'function') {
    return;
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed (ต้องส่งแบบ POST เท่านั้น)' });
  }

  try {
    const forwarded = req.headers?.['x-forwarded-for'];
    const clientIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress || '127.0.0.1';

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ success: false, error: 'รูปแบบ JSON ไม่ถูกต้อง' });
      }
    }

    const result = await processAiMoveRequest(body, clientIp);
    return res.status(result.status).json(result.data);
  } catch (globalError: any) {
    console.error('Unhandled Vercel serverless error:', globalError);
    return res.status(500).json({
      success: false,
      error: `เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์ Vercel: ${globalError?.message || 'Unknown error'}`,
    });
  }
}
