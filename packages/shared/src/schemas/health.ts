import { z } from 'zod';

export const healthStatusSchema = z.object({ ok: z.boolean(), service: z.string() });
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const health = (service: string): HealthStatus => ({ ok: true, service });
