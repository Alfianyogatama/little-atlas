import { z } from 'zod';

export const FlagQuizAnswerSchema = z.object({
  itemId: z.string(),
  correct: z.boolean(),
  sessionId: z.string(),
  answeredAt: z.number(),
});

export const ProgressRecordSchema = z.object({
  profileId: z.string().min(1),
  stars: z.number().int().min(0),
  flagQuizLevel: z.number().int().min(1),
  flagQuizWindow: z.array(FlagQuizAnswerSchema).max(10),
});
export type ProgressRecord = z.infer<typeof ProgressRecordSchema>;
