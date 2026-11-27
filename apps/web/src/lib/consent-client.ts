import {
  PRIVACY_NOTICE_VERSION,
  consentRecordSchema,
  grantConsentRequestSchema,
  type ConsentRecord,
} from '@hush/shared';

export type ConsentResult = { ok: true; record: ConsentRecord } | { ok: false };

// Any failure (HTTP, network, abort, bad body) is { ok: false }: callers fail closed.
const request = async (init: RequestInit): Promise<ConsentResult> => {
  try {
    const res = await fetch('/api/consent', init);
    if (!res.ok) return { ok: false };
    const record = consentRecordSchema.safeParse(await res.json());
    return record.success ? { ok: true, record: record.data } : { ok: false };
  } catch {
    return { ok: false };
  }
};

/** GET the user's current chat consent via the same-origin /api/consent rewrite. Never throws. */
export const getConsent = (signal: AbortSignal): Promise<ConsentResult> => request({ signal });

/** POST consent for the current notice version. Never throws. */
export const grantConsent = (signal: AbortSignal): Promise<ConsentResult> =>
  request({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      grantConsentRequestSchema.parse({ purpose: 'chat', noticeVersion: PRIVACY_NOTICE_VERSION }),
    ),
    signal,
  });
