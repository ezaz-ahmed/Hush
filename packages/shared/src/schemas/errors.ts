import { z } from 'zod';

// Strict so an issue can never carry zod's message or the input: those may hold PII.
export const validationIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** The 400 body ZodValidationPipe returns. */
export const validationErrorSchema = z.strictObject({
  statusCode: z.literal(400),
  error: z.literal('Bad Request'),
  message: z.array(validationIssueSchema),
});
export type ValidationError = z.infer<typeof validationErrorSchema>;

/** The 429 body POST /chat returns when a rate limit is hit. */
export const rateLimitErrorSchema = z.strictObject({
  statusCode: z.literal(429),
  error: z.literal('Too Many Requests'),
  retryAfter: z.number().int().positive(), // seconds; same value as the Retry-After header
});
export type RateLimitError = z.infer<typeof rateLimitErrorSchema>;
