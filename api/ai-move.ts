import { processAiMoveRequest } from '../lib/ai-move-service';

// Helper to safely parse body in any Vercel execution environment
async function parseBody(req: any): Promise<any> {
  // 1. Web Standard Request (req.json())
  if (req && typeof req.json === 'function') {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }

  // 2. Already parsed object
  if (req && req.body && typeof req.body === 'object') {
    return req.body;
  }

  // 3. String body
  if (req && typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  // 4. Node.js Readable stream
  if (req && typeof req.on === 'function') {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk: any) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  return null;
}

// Helper to extract IP in any Vercel execution environment
function extractIp(req: any): string {
  try {
    if (req?.headers?.get && typeof req.headers.get === 'function') {
      const forwarded = req.headers.get('x-forwarded-for');
      if (forwarded) return forwarded.split(',')[0].trim();
    }

    const headers = req?.headers;
    if (headers) {
      const forwarded = headers['x-forwarded-for'];
      if (Array.isArray(forwarded)) return forwarded[0];
      if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    }

    return req?.socket?.remoteAddress || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

// Handler for Web Standard / Edge / Next.js Route POST
export async function POST(req: any): Promise<Response> {
  try {
    const body = await parseBody(req);
    const ip = extractIp(req);
    const result = await processAiMoveRequest(body, ip);

    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error: any) {
    console.error('Vercel POST API error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'เกิดข้อผิดพลาดในการประมวลผลบน Vercel',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Default export handler for Node.js / Express style Serverless Function
export default async function handler(req: any, res?: any) {
  // If invoked in Web Standard environment where res is not provided
  if (!res || typeof res.status !== 'function') {
    return POST(req);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method Not Allowed (ต้องส่งแบบ POST เท่านั้น)',
    });
  }

  try {
    const body = await parseBody(req);
    const ip = extractIp(req);
    const result = await processAiMoveRequest(body, ip);

    return res.status(result.status).json(result.data);
  } catch (error: any) {
    console.error('Vercel handler API error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'เกิดข้อผิดพลาดในการประมวลผลบน Vercel Serverless',
    });
  }
}
