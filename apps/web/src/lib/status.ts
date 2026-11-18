import { healthStatusSchema, type HealthStatus } from '@hush/shared';
import { env } from './env';

const down: HealthStatus = { ok: false, service: 'api' };

/** The API's health as the web sees it. Any failure, bad status or bad body counts as down. */
export const status = async (): Promise<HealthStatus> => {
  try {
    // no-store makes the page render per request instead of baking the build-time answer in.
    const res = await fetch(`${env.API_URL}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return down;
    const parsed = healthStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : down;
  } catch {
    return down;
  }
};
