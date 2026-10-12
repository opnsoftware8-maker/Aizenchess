import { processAiMoveRequest } from '../lib/ai-move-service';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress || '127.0.0.1';

    const result = await processAiMoveRequest(req.body, ip);
    return res.status(result.status).json(result.data);
  } catch (error: any) {
    console.error('Vercel API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error in API handler',
    });
  }
}
