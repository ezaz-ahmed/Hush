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
    expect(validateEnv(base)).toEqual({ PORT: 5555, ANTHROPIC_MODEL: 'claude-haiku-5-5', ...base });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...base, PORT: '6000' })).toEqual({
      PORT: 6000,
      ANTHROPIC_MODEL: 'claude-haiku-5-5',
      ...base,
    });
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
      expect(validateEnv({ ...base, [name]: url })).toEqual({
        PORT: 5555,
        ANTHROPIC_MODEL: 'claude-haiku-5-5',
        ...base,
        [name]: url,
      });
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
      ANTHROPIC_MODEL: 'claude-haiku-5-5',
      ...base,
    });
  });

  describe('VOYAGE_API_KEY', () => {
    it('is optional (key absent when unset)', () => {
      expect(validateEnv(base)).toStrictEqual({
        PORT: 5555,
        ANTHROPIC_MODEL: 'claude-haiku-5-5',
        ...base,
      });
    });

    it('treats a blank value as unset (key absent from the result)', () => {
      expect(validateEnv({ ...base, VOYAGE_API_KEY: '' })).toStrictEqual({
        PORT: 5555,
        ANTHROPIC_MODEL: 'claude-haiku-5-5',
        ...base,
      });
    });

    it('passes a set value through', () => {
      expect(validateEnv({ ...base, VOYAGE_API_KEY: 'pa-test' })).toStrictEqual({
        PORT: 5555,
        ANTHROPIC_MODEL: 'claude-haiku-5-5',
        ...base,
        VOYAGE_API_KEY: 'pa-test',
      });
    });
  });

  describe('ANTHROPIC_API_KEY', () => {
    it('is optional (key absent when unset)', () => {
      expect(validateEnv(base)).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    it('treats a blank value as unset (key absent from the result)', () => {
      expect(validateEnv({ ...base, ANTHROPIC_API_KEY: '' })).not.toHaveProperty(
        'ANTHROPIC_API_KEY',
      );
    });

    it('passes a set value through', () => {
      expect(validateEnv({ ...base, ANTHROPIC_API_KEY: 'sk-ant-test' })).toHaveProperty(
        'ANTHROPIC_API_KEY',
        'sk-ant-test',
      );
    });
  });

  describe('ANTHROPIC_MODEL', () => {
    it('defaults to claude-haiku-5-5', () => {
      expect(validateEnv(base).ANTHROPIC_MODEL).toBe('claude-haiku-5-5');
    });

    it('falls back to the default when blank', () => {
      expect(validateEnv({ ...base, ANTHROPIC_MODEL: '' }).ANTHROPIC_MODEL).toBe(
        'claude-haiku-5-5',
      );
    });

    it('passes a set value through', () => {
      expect(validateEnv({ ...base, ANTHROPIC_MODEL: 'claude-test' }).ANTHROPIC_MODEL).toBe(
        'claude-test',
      );
    });
  });
});
