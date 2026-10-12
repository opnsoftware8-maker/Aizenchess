import { NextRequest, NextResponse } from 'next/server';
import { processAiMoveRequest } from '@/lib/ai-move-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';

    const result = await processAiMoveRequest(body, ip);
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    console.error('API /api/ai-move route error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'เกิดข้อผิดพลาดในการประมวลผลคำขอ (Internal Server Error)',
      },
      { status: 500 }
    );
  }
}
