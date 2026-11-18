import { describe, expect, it } from 'vitest';
import { validationErrorSchema, validationIssueSchema } from './errors.js';

const body = {
  statusCode: 400,
  error: 'Bad Request',
  message: [
    { path: ['name'], code: 'invalid_type' },
    { path: ['items', 0, 'id'], code: 'too_small' },
  ],
};

describe('validationErrorSchema', () => {
  it('accepts the body ZodValidationPipe returns', () => {
    expect(validationErrorSchema.parse(body)).toEqual(body);
  });

  it('accepts an empty issue list', () => {
    expect(validationErrorSchema.safeParse({ ...body, message: [] }).success).toBe(true);
  });

  it.each([
    ['another status', { ...body, statusCode: 500 }],
    ['another error name', { ...body, error: 'Nope' }],
    ['a string message', { ...body, message: 'bad' }],
    ['an extra top-level field', { ...body, input: 'x' }],
    ['no message', { statusCode: 400, error: 'Bad Request' }],
  ])('rejects %s', (_name, value) => {
    expect(validationErrorSchema.safeParse(value).success).toBe(false);
  });
});

describe('validationIssueSchema', () => {
  // Strict on purpose: an issue carrying zod's message or the input is exactly the PII leak to catch.
  it.each([
    ['message', { path: ['a'], code: 'invalid_type', message: 'Expected string' }],
    ['input', { path: ['a'], code: 'invalid_type', input: 'jane.doe@example.com' }],
  ])('rejects an issue carrying %s', (_name, value) => {
    expect(validationIssueSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a non-string, non-number path segment', () => {
    expect(validationIssueSchema.safeParse({ path: [{}], code: 'x' }).success).toBe(false);
  });
});
