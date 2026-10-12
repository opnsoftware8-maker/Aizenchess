import { Chess } from 'chess.js';
import { GoogleGenAI, Type } from '@google/genai';
import { AiMoveRequestSchema, AiMoveResponse, AiMoveResponseSchema } from './ai-schema';

// Rate limiting in-memory: 10 requests per minute per IP
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30; // อนุญาต 30 คำขอต่อนาทีเพื่อรองรับโหมด AI vs AI

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
  // 1. ตรวจสอบ Rate Limit
  if (!checkRateLimit(clientIp)) {
    return {
      status: 429,
      data: {
        success: false,
        error: 'คำขอมากเกินไป (จำกัด 10 ครั้งต่อนาที) กรุณารอสักครู่แล้วลองใหม่',
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

  // 2. ตรวจสอบ Request ด้วย Zod
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

  const { fen, aiColor } = parseResult.data;

  // 3. ตรวจสอบตำแหน่งกระดานด้วย chess.js บนเซิร์ฟเวอร์
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

  // 4. คำนวณตาเดินที่ถูกต้องทั้งหมดบนเซิร์ฟเวอร์ (ไม่เชื่อถือจากไคลเอนต์)
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

  // Helper ทดสอบความถูกต้องของตาเดินบน chess.js
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

  // 5. เตรียมเรียกใช้ Gemini API
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      status: 500,
      data: {
        success: false,
        error: 'ไม่ได้ตั้งค่า GEMINI_API_KEY ในสภาพแวดล้อมระบบ',
      },
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // ใช้ gemini-3.1-flash-lite เป็นโมเดลหลัก (ตัวต่ำสุด เร็วสุด ประหยัดโควตา เสถียรที่สุด)
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
      from: {
        type: Type.STRING,
        description: 'Source square (e.g., e7)',
      },
      to: {
        type: Type.STRING,
        description: 'Destination square (e.g., e5)',
      },
      promotion: {
        type: Type.STRING,
        description: "Promotion piece: 'q', 'r', 'b', 'n', or null",
        nullable: true,
      },
      reason: {
        type: Type.STRING,
        description: 'Short Thai explanation of the move (max 120 characters)',
      },
    },
    required: ['from', 'to'],
  };

  let lastApiError = '';

  async function requestMoveFromGemini(promptText: string): Promise<AiMoveResponse | null> {
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

        // ดึงเฉพาะเนื้อหา JSON กรณีมี Markdown หุ้ม
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
        // ลองโมเดลถัดไปใน modelCandidates
      }
    }
    return null;
  }

  // รอบที่ 1: ขอตาเดินจาก AI
  let chosen = await requestMoveFromGemini(primaryPrompt);
  let validation = chosen ? testMove(chosen) : { valid: false, moveResult: null, newFen: '', from: '', to: '', promotion: null };

  // รอบที่ 2: หากตาเดินไม่ถูกต้อง ให้หน่วงเวลาเล็กน้อยแล้ว Retry 1 ครั้งตามข้อกำหนด
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

  // หากยังไม่ถูกต้อง ส่งข้อความแจ้งข้อผิดพลาดที่ชัดเจนตามสถานการณ์
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
