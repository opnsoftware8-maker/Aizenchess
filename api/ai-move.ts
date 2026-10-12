import { Chess } from 'chess.js';
import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';

// Rate limiting in-memory: 10 requests per minute per IP
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;

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

const LegalMoveSchema = z.object({
  from: z.string().regex(/^[a-hA-H][1-8]$/, 'Invalid from square'),
  to: z.string().regex(/^[a-hA-H][1-8]$/, 'Invalid to square'),
  promotion: z
    .union([z.literal('q'), z.literal('r'), z.literal('b'), z.literal('n'), z.literal(''), z.null()])
    .optional(),
  san: z.string().optional(),
});

const AiMoveRequestSchema = z.object({
  fen: z.string().min(1, 'FEN is required'),
  aiColor: z.union([z.literal('w'), z.literal('b')]),
  legalMoves: z.array(LegalMoveSchema).optional(),
});

const AiMoveResponseSchema = z.object({
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

export default async function handler(req: any, res: any) {
  // Ensure response object is valid
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
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    // 1. Resolve IP
    const forwarded = req.headers?.['x-forwarded-for'];
    const clientIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress || '127.0.0.1';

    // 2. Rate limit
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        success: false,
        error: 'คำขอมากเกินไป (จำกัด 10 ครั้งต่อนาที) กรุณารอสักครู่แล้วลองใหม่',
      });
    }

    // 3. Parse body safely (supports JSON object, raw string, and buffer)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ success: false, error: 'รูปแบบ JSON ไม่ถูกต้อง' });
      }
    }

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลคำขอ' });
    }

    const parseResult = AiMoveRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: `ข้อมูลไม่ถูกต้อง: ${parseResult.error.message || 'รูปแบบไม่ถูกต้อง'}`,
      });
    }

    const { fen, aiColor } = parseResult.data;

    let game: Chess;
    try {
      game = new Chess(fen);
    } catch {
      return res.status(400).json({ success: false, error: 'FEN รูปแบบกระดานไม่ถูกต้อง' });
    }

    if (game.isGameOver()) {
      return res.status(400).json({ success: false, error: 'เกมจบลงแล้ว ไม่สามารถเดินหมากต่อได้' });
    }

    if (game.turn() !== aiColor) {
      return res.status(400).json({
        success: false,
        error: `ไม่ใช่ตาเดินของ AI (ตาเดินปัจจุบันคือฝ่าย ${game.turn() === 'w' ? 'ขาว' : 'ดำ'})`,
      });
    }

    const serverLegalMoves = game.moves({ verbose: true });
    if (serverLegalMoves.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่มีตาเดินที่ถูกต้องสำหรับตำแหน่งนี้' });
    }

    const legalMovesList = serverLegalMoves.map((m) => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion || null,
      san: m.san,
    }));

    const testMove = (candidate: { from: string; to: string; promotion?: string | null }) => {
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
          return { valid: false, moveResult: null, newFen: '', from, to, promotion: null };
        }

        const resMove = clone.move({ from, to, promotion });
        return {
          valid: !!resMove,
          moveResult: resMove,
          newFen: clone.fen(),
          from,
          to,
          promotion: promotion || null,
        };
      } catch {
        return { valid: false, moveResult: null, newFen: '', from: candidate.from, to: candidate.to, promotion: null };
      }
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'ไม่ได้ตั้งค่า GEMINI_API_KEY ใน Vercel Environment Variables กรุณาตั้งค่าใน Vercel Dashboard -> Settings -> Environment Variables แล้วกด Redeploy',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const configuredModel = process.env.GEMINI_MODEL;
    const defaultPrimaryModel = 'gemini-3.1-flash-lite';
    const primaryModel = configuredModel && configuredModel !== 'gemini-3.8-flash'
      ? configuredModel
      : defaultPrimaryModel;

    const rawModelList = [
      primaryModel,
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-3.8-flash',
    ].filter(Boolean) as string[];
    const modelCandidates = Array.from(new Set(rawModelList));

    const systemInstruction = `You are a competitive chess master engine playing as ${
      aiColor === 'w' ? 'White (w)' : 'Black (b)'
    }.
You must evaluate the position and select the strongest move strictly from the provided list of legal moves.
Provide a concise explanation in Thai (maximum 120 characters) explaining why this move was chosen.
You must return only valid JSON adhering to the provided schema.`;

    const primaryPrompt = `Current board FEN: "${fen}"
AI Color: "${aiColor}" (${aiColor === 'w' ? 'White' : 'Black'})

Here are all computed legal moves for your turn:
${JSON.stringify(legalMovesList, null, 2)}

Strict instruction:
Choose EXACTLY ONE move from the legal moves list above.
Return the 'from', 'to', 'promotion' (if pawn promotion, else null), and a brief Thai reason in 'reason'.`;

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

    let lastApiError = '';

    async function requestMoveFromGemini(promptText: string) {
      for (const model of modelCandidates) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: promptText,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema,
              temperature: 0.2,
            },
          });

          let rawText = response.text?.trim();
          if (!rawText) continue;

          if (rawText.startsWith('```')) {
            rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          }

          const parsed = JSON.parse(rawText);
          const validation = AiMoveResponseSchema.safeParse(parsed);
          if (!validation.success) continue;

          return {
            from: String(validation.data.from).trim(),
            to: String(validation.data.to).trim(),
            promotion: validation.data.promotion ?? null,
            reason: typeof validation.data.reason === 'string' ? validation.data.reason.slice(0, 150) : '',
          };
        } catch (err: any) {
          lastApiError = err?.message || String(err);
          console.warn(`Gemini attempt failed with model ${model}:`, lastApiError);
        }
      }
      return null;
    }

    let chosen = await requestMoveFromGemini(primaryPrompt);
    let validation = chosen ? testMove(chosen) : { valid: false, moveResult: null, newFen: '', from: '', to: '', promotion: null };

    if (!validation.valid) {
      await new Promise((r) => setTimeout(r, 800));
      const retryPrompt = `Your previous choice was invalid. Choose exactly one move from this legal move list:\n${JSON.stringify(
        legalMovesList,
        null,
        2
      )}`;
      chosen = await requestMoveFromGemini(retryPrompt);
      validation = chosen ? testMove(chosen) : { valid: false, moveResult: null, newFen: '', from: '', to: '', promotion: null };
    }

    if (!validation.valid || !chosen || !validation.moveResult) {
      let errorMessage = 'AI ตอบกลับตาเดินที่ไม่ถูกต้องหรือไม่สามารถเดินได้ กรุณากดปุ่มลองอีกครั้ง';
      let statusCode = 422;

      if (!chosen && lastApiError) {
        if (lastApiError.includes('429') || lastApiError.includes('RESOURCE_EXHAUSTED') || lastApiError.toLowerCase().includes('quota')) {
          errorMessage = 'โควตาการใช้งาน Gemini API เต็มชั่วคราว (Quota Exceeded: 429) กรุณารอสักครู่แล้วกดปุ่มลองอีกครั้ง';
          statusCode = 429;
        } else if (lastApiError.includes('503') || lastApiError.includes('high demand') || lastApiError.includes('UNAVAILABLE')) {
          errorMessage = 'เซิร์ฟเวอร์ AI มีผู้ใช้งานหนาแน่นชั่วคราว (503) กรุณากดปุ่มลองอีกครั้ง';
          statusCode = 503;
        } else {
          errorMessage = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ AI ได้ในขณะนี้ กรุณากดปุ่มลองอีกครั้ง';
          statusCode = 502;
        }
      }

      return res.status(statusCode).json({ success: false, error: errorMessage });
    }

    return res.status(200).json({
      success: true,
      move: {
        from: validation.from,
        to: validation.to,
        promotion: validation.promotion,
        san: validation.moveResult.san,
        reason: chosen.reason?.slice(0, 120) || 'เดินตามกลยุทธ์ AI',
      },
      newFen: validation.newFen,
    });
  } catch (globalError: any) {
    console.error('Unhandled Vercel serverless error:', globalError);
    return res.status(500).json({
      success: false,
      error: `เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์ Vercel: ${globalError?.message || 'Unknown error'}`,
    });
  }
}
