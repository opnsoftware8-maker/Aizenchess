import { Chess } from 'chess.js';
import { GoogleGenAI, Type } from '@google/genai';
import { AiMoveRequestSchema, AiMoveResponse, AiMoveResponseSchema } from './ai-schema';

// Rate limiting in-memory: 30 requests per minute per IP
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30; // 30 requests per minute

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
        };
        newFen: string;
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
  // 1. Rate Limit
  if (!checkRateLimit(clientIp)) {
    return {
      status: 429,
      data: {
        success: false,
        error: 'คำขอมากเกินไป (จำกัด 30 ครั้งต่อนาที) กรุณารอสักครู่แล้วลองใหม่',
      },
    };
  }

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

  // 2. Validate Request with Zod
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

  const { fen, aiColor, provider = 'gemini', model } = parseResult.data;

  // 3. Validate Chess Board State
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

  // 4. Compute Legal Moves on Server
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

  // Generic JSON cleaner
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      lastApiError = 'ไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment Variables';
      return null;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const requestedModel = model || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const modelCandidates = Array.from(
      new Set([
        requestedModel,
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.1-flash-lite-preview',
        'gemini-3-flash-preview',
        'gemini-3.8-flash',
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
        console.warn(`Gemini attempt failed with model ${m}:`, lastApiError);
      }
    }
    return null;
  }

  // Attempt 1
  let chosen = await callGemini(primaryPrompt);
  let validation = chosen ? testMove(chosen) : { valid: false, moveResult: null, newFen: '', from: '', to: '', promotion: null };

  // Attempt 2 (Retry once with corrected prompt if invalid)
  if (!validation.valid && (!lastApiError || !lastApiError.includes('ไม่ได้ตั้งค่า'))) {
    await new Promise((r) => setTimeout(r, 800));

    const retryPrompt = `Your previous choice was invalid. Choose exactly one move from this legal move list:\n${JSON.stringify(
      legalMovesList,
      null,
      2
    )}`;

    chosen = await callGemini(retryPrompt);
    validation = chosen ? testMove(chosen) : { valid: false, moveResult: null, newFen: '', from: '', to: '', promotion: null };
  }

  // Format safe response on failure
  if (!validation.valid || !chosen || !validation.moveResult) {
    let errorMessage = 'AI ตอบกลับตาเดินที่ไม่ถูกต้องหรือไม่สามารถเดินได้ กรุณากดปุ่มลองอีกครั้ง';
    let statusCode = 422;

    if (lastApiError) {
      if (lastApiError.includes('ไม่ได้ตั้งค่า')) {
        errorMessage = lastApiError;
        statusCode = 400;
      } else if (lastApiError.includes('429') || lastApiError.includes('RESOURCE_EXHAUSTED') || lastApiError.toLowerCase().includes('quota')) {
        errorMessage = 'โควตาการใช้งาน Gemini API เต็มชั่วคราว (Quota Exceeded: 429) กรุณารอสักครู่แล้วกดปุ่มลองอีกครั้ง';
        statusCode = 429;
      } else if (lastApiError.includes('503') || lastApiError.includes('high demand') || lastApiError.includes('UNAVAILABLE')) {
        errorMessage = 'เซิร์ฟเวอร์ AI มีผู้ใช้งานหนาแน่นชั่วคราว (503) กรุณากดปุ่มลองอีกครั้ง';
        statusCode = 503;
      } else {
        errorMessage = `เกิดข้อผิดพลาดจาก AI: ${lastApiError.slice(0, 120)}`;
        statusCode = 502;
      }
    }

    return {
      status: statusCode,
      data: {
        success: false,
        error: errorMessage,
      },
    };
  }

  return {
    status: 200,
    data: {
      success: true,
      move: {
        from: validation.from,
        to: validation.to,
        promotion: validation.promotion,
        san: validation.moveResult.san,
        reason: chosen.reason?.slice(0, 120) || 'เดินตามกลยุทธ์ AI',
      },
      newFen: validation.newFen,
    },
  };
}
