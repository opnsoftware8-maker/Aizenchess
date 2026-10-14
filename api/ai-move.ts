import { Chess } from 'chess.js';
import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';

// Zod schemas
export const LegalMoveSchema = z.object({
  from: z.string().regex(/^[a-hA-H][1-8]$/, 'Invalid from square'),
  to: z.string().regex(/^[a-hA-H][1-8]$/, 'Invalid to square'),
  promotion: z
    .union([z.literal('q'), z.literal('r'), z.literal('b'), z.literal('n'), z.literal(''), z.null()])
    .optional(),
  san: z.string().optional(),
});

export type LegalMove = z.infer<typeof LegalMoveSchema>;

export const AiMoveRequestSchema = z.object({
  fen: z.string().optional(),
  aiColor: z.union([z.literal('w'), z.literal('b')]).optional(),
  legalMoves: z.array(LegalMoveSchema).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  action: z.string().optional(),
});

export type AiMoveRequest = z.infer<typeof AiMoveRequestSchema>;

export const AiMoveResponseSchema = z.object({
  from: z.string().regex(/^[a-hA-H][1-8]$/, 'Invalid from square'),
  to: z.string().regex(/^[a-hA-H][1-8]$/, 'Invalid to square'),
  promotion: z
    .union([
      z.literal('q'),
      z.literal('r'),
      z.literal('b'),
      z.literal('n'),
      z.literal('Q'),
      z.literal('R'),
      z.literal('B'),
      z.literal('N'),
      z.literal(''),
      z.literal('none'),
      z.null(),
    ])
    .optional(),
  reason: z.any().optional(),
});

export type AiMoveResponse = z.infer<typeof AiMoveResponseSchema>;

// Rate limiting in-memory: 30 requests per minute per IP for shared server quota
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30;

  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count += 1;
  return true;
}

export interface HandleAiMoveResult {
  status: number;
  data:
    | {
        success: true;
        move: {
          from: string;
          to: string;
          promotion: string | null;
          san: string;
          reason: string;
          isCustomKey?: boolean;
        };
        newFen: string;
      }
    | {
        success: true;
        message: string;
      }
    | {
        success: false;
        error: string;
      };
}

export async function processAiMoveRequest(
  body: unknown,
  clientIp: string
): Promise<HandleAiMoveResult> {
  let parsedInput = body;
  if (typeof body === 'string') {
    try {
      parsedInput = JSON.parse(body);
    } catch {
      return {
        status: 400,
        data: {
          success: false,
          error: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง',
        },
      };
    }
  }

  // 1. Validate Request with Zod
  const parseResult = AiMoveRequestSchema.safeParse(parsedInput);
  if (!parseResult.success) {
    return {
      status: 400,
      data: {
        success: false,
        error: `ข้อมูลไม่ถูกต้อง: ${parseResult.error.message || 'รูปแบบไม่ถูกต้อง'}`,
      },
    };
  }

  const { fen, aiColor, model, apiKey, action } = parseResult.data;
  const userProvidedKey = typeof apiKey === 'string' && apiKey.trim().length > 0 ? apiKey.trim() : null;

  // 2. Action: Verify user API key
  if (action === 'verify-key') {
    if (!userProvidedKey) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'กรุณากรอก API Key ก่อนทดสอบ',
        },
      };
    }

    try {
      const testAi = new GoogleGenAI({
        apiKey: userProvidedKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const testRes = await testAi.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: 'Respond with the single word "OK"',
      });

      if (testRes.text) {
        return {
          status: 200,
          data: {
            success: true,
            message: 'API Key ใช้งานได้สมบูรณ์! คุณสามารถใช้เล่นทั้งโหมดผู้เล่น vs AI และ AI vs AI ได้ไม่จำกัด',
          },
        };
      } else {
        return {
          status: 200,
          data: {
            success: true,
            message: 'API Key เชื่อมต่อสำเร็จ พร้อมใช้งาน',
          },
        };
      }
    } catch (testErr: any) {
      const msg = testErr?.message || String(testErr);
      let thaiMsg = msg;
      if (msg.includes('API_KEY_INVALID') || msg.includes('400') || msg.includes('API key not valid')) {
        thaiMsg = 'API Key ไม่ถูกต้อง กรุณาคัดลอกจาก Google AI Studio ให้ครบถ้วน';
      } else if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        thaiMsg = 'API Key นี้เกินโควตาใช้งานชั่วคราว กรุณาตรวจสอบสถานะโควตาใน Google AI Studio';
      } else if (msg.includes('PERMISSION_DENIED')) {
        thaiMsg = 'สิทธิ์การใช้งาน API Key ถูกปฏิเสธ กรุณาตรวจสอบการตั้งค่าโครงการใน Google AI Studio';
      }
      return {
        status: 400,
        data: {
          success: false,
          error: `การทดสอบ API Key ล้มเหลว: ${thaiMsg}`,
        },
      };
    }
  }

  // 3. Move generation requires fen and aiColor
  if (!fen || !aiColor) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'ต้องระบุ fen และ aiColor เพื่อขอตาเดินของ AI',
      },
    };
  }

  // 4. Rate Limit (Bypassed if user provides their own private API key)
  if (!userProvidedKey && !checkRateLimit(clientIp)) {
    return {
      status: 429,
      data: {
        success: false,
        error: 'คำขอมากเกินไป (จำกัด 30 ครั้งต่อนาทีสำหรับโควตาฟรีส่วนกลาง) แนะนำให้ใส่ API Key ส่วนตัวเพื่อเล่นได้ไม่จำกัด',
      },
    };
  }

  // 5. Validate Chess Board State
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return {
      status: 400,
      data: {
        success: false,
        error: 'FEN รูปแบบกระดานไม่ถูกต้อง',
      },
    };
  }

  if (game.isGameOver()) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'เกมจบลงแล้ว ไม่สามารถเดินหมากต่อได้',
      },
    };
  }

  if (game.turn() !== aiColor) {
    return {
      status: 400,
      data: {
        success: false,
        error: `ไม่ใช่ตาเดินของ AI (ตาเดินปัจจุบันคือฝ่าย ${game.turn() === 'w' ? 'ขาว' : 'ดำ'})`,
      },
    };
  }

  // 6. Compute Legal Moves on Server
  const serverLegalMoves = game.moves({ verbose: true });
  if (serverLegalMoves.length === 0) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'ไม่มีตาเดินที่ถูกต้องสำหรับตำแหน่งนี้',
      },
    };
  }

  const legalMovesList = serverLegalMoves.map((m) => ({
    from: m.from,
    to: m.to,
    promotion: m.promotion || null,
    san: m.san,
  }));

  // Test Move validity
  const testMove = (
    candidate: { from: string; to: string; promotion?: string | null }
  ) => {
    try {
      const clone = new Chess(fen);
      const from = candidate.from.toLowerCase().trim();
      const to = candidate.to.toLowerCase().trim();
      let promotion: 'q' | 'r' | 'b' | 'n' | undefined;
      if (candidate.promotion) {
        const p = candidate.promotion.toLowerCase().trim();
        if (['q', 'r', 'b', 'n'].includes(p)) {
          promotion = p as 'q' | 'r' | 'b' | 'n';
        }
      }

      const isLegal = serverLegalMoves.some(
        (m) =>
          m.from.toLowerCase() === from &&
          m.to.toLowerCase() === to &&
          (!promotion || m.promotion === promotion)
      );
      if (!isLegal) {
        return {
          valid: false,
          moveResult: null,
          newFen: '',
          from,
          to,
          promotion: null,
        };
      }

      const res = clone.move({
        from,
        to,
        promotion,
      });

      return {
        valid: !!res,
        moveResult: res,
        newFen: clone.fen(),
        from,
        to,
        promotion: promotion || null,
      };
    } catch {
      return {
        valid: false,
        moveResult: null,
        newFen: '',
        from: candidate.from,
        to: candidate.to,
        promotion: null,
      };
    }
  };

  const systemInstruction = `You are a competitive chess master engine playing as ${
    aiColor === 'w' ? 'White (w)' : 'Black (b)'
  }.
You must evaluate the position and select the strongest move strictly from the provided list of legal moves.
Provide a concise explanation in Thai (maximum 120 characters) explaining why this move was chosen.
Return strictly a valid JSON object matching this schema:
{"from": "square", "to": "square", "promotion": "q|r|b|n|null", "reason": "Thai reason"}`;

  const primaryPrompt = `Current board FEN: "${fen}"
AI Color: "${aiColor}" (${aiColor === 'w' ? 'White' : 'Black'})

Here are all computed legal moves for your turn:
${JSON.stringify(legalMovesList, null, 2)}

Strict instruction:
Choose EXACTLY ONE move from the legal moves list above.
Return JSON with 'from', 'to', 'promotion' (if pawn promotion, else null), and a brief Thai explanation in 'reason'.`;

  let lastApiError = '';
  let hitUserKeyQuotaOrError = false;

  function cleanAndParseJson(text: string): AiMoveResponse | null {
    try {
      let rawText = text.trim();
      if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      }
      const parsed = JSON.parse(rawText);
      const validation = AiMoveResponseSchema.safeParse(parsed);
      if (!validation.success) return null;
      return {
        from: String(validation.data.from).trim(),
        to: String(validation.data.to).trim(),
        promotion: validation.data.promotion ?? null,
        reason: typeof validation.data.reason === 'string' ? validation.data.reason.slice(0, 150) : '',
      };
    } catch {
      return null;
    }
  }

  // Caller for Google Gemini
  async function callGemini(promptText: string): Promise<AiMoveResponse | null> {
    const effectiveApiKey =
      userProvidedKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_KEY ||
      process.env.VITE_GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!effectiveApiKey) {
      lastApiError = 'ไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ กรุณาใส่ API Key ของคุณเองที่ปุ่ม "ตั้งค่า API Key" เพื่อเริ่มเล่น';
      return null;
    }

    const ai = new GoogleGenAI({
      apiKey: effectiveApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const requestedModel = model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const modelCandidates = Array.from(
      new Set([
        requestedModel,
        'gemini-3.8-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.1-pro-preview',
      ].filter(Boolean) as string[])
    );

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING },
        to: { type: Type.STRING },
        promotion: { type: Type.STRING, nullable: true },
        reason: { type: Type.STRING },
      },
      required: ['from', 'to'],
    };

    for (const m of modelCandidates) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: promptText,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0.2,
          },
        });

        if (response.text) {
          const parsed = cleanAndParseJson(response.text);
          if (parsed) return parsed;
        }
      } catch (err: any) {
        lastApiError = err?.message || String(err);
        const isQuota = lastApiError.includes('429') || lastApiError.includes('RESOURCE_EXHAUSTED');
        if (userProvidedKey) {
          hitUserKeyQuotaOrError = true;
          console.warn(`User API Key attempt failed on model ${m}:`, lastApiError);
        } else {
          if (isQuota) {
            console.info(`Model ${m} reached free tier quota limit, checking fallback candidate...`);
          } else {
            console.warn(`Gemini attempt failed with model ${m}:`, lastApiError);
          }
        }
      }
    }
    return null;
  }

  // Attempt 1
  let chosen = await callGemini(primaryPrompt);
  let validation = chosen ? testMove(chosen) : { valid: false, moveResult: null, newFen: '', from: '', to: '', promotion: null };

  // Attempt 2 (Retry once with corrected prompt if invalid)
  if (!validation.valid && (!lastApiError || !lastApiError.includes('ไม่ได้ตั้งค่า'))) {
    await new Promise((r) => setTimeout(r, 600));

    const retryPrompt = `Your previous choice was invalid. Choose exactly one move from this legal move list:\n${JSON.stringify(
      legalMovesList,
      null,
      2
    )}`;

    chosen = await callGemini(retryPrompt);
    validation = chosen ? testMove(chosen) : { valid: false, moveResult: null, newFen: '', from: '', to: '', promotion: null };
  }

  // If GEMINI_API_KEY is not set anywhere, return clear error
  if (lastApiError && lastApiError.includes('ไม่ได้ตั้งค่า')) {
    return {
      status: 400,
      data: {
        success: false,
        error: lastApiError,
      },
    };
  }

  // If user provided their own key and it is invalid, inform them clearly
  if (userProvidedKey && hitUserKeyQuotaOrError && !chosen) {
    if (lastApiError.includes('API_KEY_INVALID') || lastApiError.includes('API key not valid')) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'API Key ที่คุณระบุไม่ถูกต้อง กรุณากดปุ่ม "ตั้งค่า API Key" แล้วตรวจสอบคีย์อีกครั้ง',
        },
      };
    }
  }

  // Safe fallback to valid chess legal move if quota exceeded or temporary network issue
  if (!validation.valid || !chosen || !validation.moveResult) {
    if (legalMovesList && legalMovesList.length > 0) {
      const captureMoves = legalMovesList.filter((m) => m.san.includes('x') || m.san.includes('+') || m.san.includes('#'));
      const pool = captureMoves.length > 0 ? captureMoves : legalMovesList;
      const fallbackRaw = pool[Math.floor(Math.random() * pool.length)];
      const testRes = testMove(fallbackRaw);
      if (testRes.valid && testRes.moveResult) {
        return {
          status: 200,
          data: {
            success: true,
            move: {
              from: testRes.from,
              to: testRes.to,
              promotion: testRes.promotion,
              san: testRes.moveResult.san,
              reason: userProvidedKey
                ? 'เดินหมากคำนวณสำรอง (เนื่องจากโมเดล AI ตอบสนองช้า)'
                : 'เดินอัตโนมัติสำรอง (เนื่องจากโควตาเซิร์ฟเวอร์เต็ม — คุณสามารถกดปุ่ม "ตั้งค่า API Key" เพื่อใส่คีย์ฟรีของตนเองได้)',
              isCustomKey: !!userProvidedKey,
            },
            newFen: testRes.newFen,
          },
        };
      }
    }
  }

  return {
    status: 200,
    data: {
      success: true,
      move: {
        from: validation.from,
        to: validation.to,
        promotion: validation.promotion,
        san: validation.moveResult?.san || 'e4',
        reason: chosen?.reason?.slice(0, 120) || 'เดินตามกลยุทธ์ AI',
        isCustomKey: !!userProvidedKey,
      },
      newFen: validation.newFen,
    },
  };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-requested-with, x-gemini-api-key',
};

async function readRequestBody(req: any): Promise<any> {
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }

  // If Web standard Request object
  if (typeof req.json === 'function') {
    try {
      return await req.json();
    } catch {
      return {};
    }
  }

  // If Node.js IncomingMessage stream
  if (typeof req.on === 'function') {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk: any) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch {
          resolve({});
        }
      });
      req.on('error', () => {
        resolve({});
      });
    });
  }

  return {};
}

function extractClientIp(req: any): string {
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.get?.('x-forwarded-for');
  if (Array.isArray(forwarded)) return forwarded[0];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Universal Handler compatible with:
 * 1. Node.js Serverless Functions: handler(req, res)
 * 2. Web Standard / Edge Functions: POST(request)
 */
export default async function handler(req: any, res?: any) {
  // --- Case A: Node.js Runtime (req: IncomingMessage, res: ServerResponse) ---
  if (res && typeof res.status === 'function') {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method === 'GET') {
      return res.status(200).json({ status: 'ok', message: 'Chess AI API endpoint ready' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method Not Allowed (ต้องส่งแบบ POST เท่านั้น)' });
    }

    try {
      const clientIp = extractClientIp(req);
      const body = await readRequestBody(req);
      const headerKey = req.headers?.['x-gemini-api-key'];
      if (headerKey && typeof body === 'object' && body !== null && !body.apiKey) {
        body.apiKey = headerKey;
      }
      const result = await processAiMoveRequest(body, clientIp);
      return res.status(result.status).json(result.data);
    } catch (err: any) {
      console.error('Vercel handler error:', err);
      return res.status(500).json({
        success: false,
        error: `เซิร์ฟเวอร์เกิดข้อผิดพลาด: ${err?.message || 'Unknown error'}`,
      });
    }
  }

  // --- Case B: Web Standards / Edge Runtime (req is Request, res is undefined) ---
  const method = req.method || 'POST';
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', message: 'Chess AI API endpoint ready' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const clientIp = extractClientIp(req);
    const body = await readRequestBody(req);
    const headerKey = req.headers?.get?.('x-gemini-api-key');
    if (headerKey && typeof body === 'object' && body !== null && !body.apiKey) {
      body.apiKey = headerKey;
    }
    const result = await processAiMoveRequest(body, clientIp);
    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Web handler error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `เซิร์ฟเวอร์เกิดข้อผิดพลาด: ${err?.message || 'Unknown error'}`,
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function POST(req: any, res?: any) {
  return handler(req, res);
}

export async function GET(req: any, res?: any) {
  return handler(req, res);
}

export async function OPTIONS(req: any, res?: any) {
  return handler(req, res);
}
