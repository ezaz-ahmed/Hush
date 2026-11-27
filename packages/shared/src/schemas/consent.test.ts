import { describe, expect, it } from 'vitest';
import {
  consentPurposeSchema,
  consentRecordSchema,
  grantConsentRequestSchema,
  PRIVACY_NOTICE_VERSION,
} from './consent.js';

const record = { purpose: 'chat', noticeVersion: 'v1', grantedAt: '2026-11-27T10:00:00+08:00' };

describe('PRIVACY_NOTICE_VERSION', () => {
  it('is v1', () => {
    expect(PRIVACY_NOTICE_VERSION).toBe('v1');
  });
});

describe('consentPurposeSchema', () => {
  it('accepts chat and rejects other purposes', () => {
    expect(consentPurposeSchema.safeParse('chat').success).toBe(true);
    expect(consentPurposeSchema.safeParse('marketing').success).toBe(false);
  });
});

describe('grantConsentRequestSchema', () => {
  it('accepts purpose and notice version', () => {
    const body = { purpose: 'chat', noticeVersion: 'v1' };
    expect(grantConsentRequestSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['a userId key', { purpose: 'chat', noticeVersion: 'v1', userId: 'u1' }],
    ['an unknown purpose', { purpose: 'marketing', noticeVersion: 'v1' }],
    ['an empty version', { purpose: 'chat', noticeVersion: '' }],
  ])('rejects %s', (_name, body) => {
    expect(grantConsentRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('consentRecordSchema', () => {
  it('accepts an ISO datetime with offset', () => {
    expect(consentRecordSchema.parse(record)).toEqual(record);
  });

  it.each([
    ['a bad date', { ...record, grantedAt: 'yesterday' }],
    ['an extra key', { ...record, userId: 'u1' }],
  ])('rejects %s', (_name, body) => {
    expect(consentRecordSchema.safeParse(body).success).toBe(false);
  });
});
