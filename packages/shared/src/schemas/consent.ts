import { z } from 'zod';

/** The one source of the current privacy notice version. Bump it to require re-consent. */
export const PRIVACY_NOTICE_VERSION = 'v1';

// Matches the consent_purpose DB enum.
export const consentPurposeSchema = z.enum(['chat']);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

// No user id: identity comes from the request, not the body.
export const grantConsentRequestSchema = z.strictObject({
  purpose: consentPurposeSchema,
  noticeVersion: z.string().min(1),
});
export type GrantConsentRequest = z.infer<typeof grantConsentRequestSchema>;

export const consentRecordSchema = z.strictObject({
  purpose: consentPurposeSchema,
  noticeVersion: z.string().min(1),
  grantedAt: z.iso.datetime({ offset: true }),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
