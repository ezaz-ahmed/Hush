import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/hush_test' };

describe('validateEnv', () => {
  it('requires DATABASE_URL, naming it without a value', () => {
    expect(() => validateEnv({})).toThrow(new Error('Invalid env: DATABASE_URL'));
  });

  it('treats an empty DATABASE_URL as missing', () => {
    expect(() => validateEnv({ DATABASE_URL: '' })).toThrow(new Error('Invalid env: DATABASE_URL'));
  });

  it('defaults PORT to 5555', () => {
    expect(validateEnv(base)).toEqual({ PORT: 5555, ...base });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...base, PORT: '6000' })).toEqual({ PORT: 6000, ...base });
  });

  it.each(['abc', '0', '70000'])('rejects PORT=%s with only the variable name', (PORT) => {
    // Exact message: anything more (zod's text, the value) fails, which pins "names only".
    expect(() => validateEnv({ ...base, PORT })).toThrow(new Error('Invalid env: PORT'));
  });

  it('never puts env values in the error', () => {
    expect(() => validateEnv({ ...base, PORT: 'abc', SECRET: 'hunter2' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
    expect(() => validateEnv({ ...base, PORT: 'hunter2' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
  });

  describe.each(['DATABASE_URL', 'DATABASE_URL_UNPOOLED'])('%s', (name) => {
    it.each([
      'postgres://u:p@h/db',
      'postgresql://u:p@h/db',
      'postgresql://u:p@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ])('accepts %s unchanged', (url) => {
      expect(validateEnv({ ...base, [name]: url })).toEqual({ PORT: 5555, ...base, [name]: url });
    });

    it.each([
      '  ',
      'not-a-url',
      'mysql://u:p@h/db',
      'https://h/db',
      'postgresql://',
      'postgresql:///db',
      'postgres:h',
    ])('rejects %j', (value) => {
      expect(() => validateEnv({ ...base, [name]: value })).toThrow(
        new Error(`Invalid env: ${name}`),
      );
    });

    it('never puts the value in the error', () => {
      expect(() => validateEnv({ ...base, [name]: 'postgresql://u:hunter2@h:bad/db' })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
      );
    });
  });

  it('treats an empty DATABASE_URL_UNPOOLED as unset (key absent from the result)', () => {
    expect(validateEnv({ ...base, DATABASE_URL_UNPOOLED: '' })).toStrictEqual({
      PORT: 5555,
      ...base,
    });
  });
});
