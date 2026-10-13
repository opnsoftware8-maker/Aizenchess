import { z } from 'zod';

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
  fen: z.string().min(1, 'FEN is required'),
  aiColor: z.union([z.literal('w'), z.literal('b')]),
  legalMoves: z.array(LegalMoveSchema).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
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
