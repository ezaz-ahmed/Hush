import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('defaults PORT to 5555', () => {
    expect(validateEnv({})).toEqual({ PORT: 5555 });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ PORT: '6000' })).toEqual({ PORT: 6000 });
  });

  it.each(['abc', '0', '70000'])('rejects PORT=%s with only the variable name', (PORT) => {
    // Exact message: anything more (zod's text, the value) fails, which pins "names only".
    expect(() => validateEnv({ PORT })).toThrow(new Error('Invalid env: PORT'));
  });

  it('never puts env values in the error', () => {
    expect(() => validateEnv({ PORT: 'abc', SECRET: 'hunter2' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
    expect(() => validateEnv({ PORT: 'hunter2' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
  });

  describe.each(['DATABASE_URL', 'DATABASE_URL_UNPOOLED'])('%s', (name) => {
    it.each([
      'postgres://u:p@h/db',
      'postgresql://u:p@h/db',
      'postgresql://u:p@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ])('accepts %s unchanged', (url) => {
      expect(validateEnv({ [name]: url })).toEqual({ PORT: 5555, [name]: url });
    });

    it('treats an empty value as unset (key absent from the result)', () => {
      expect(validateEnv({ [name]: '' })).toStrictEqual({ PORT: 5555 });
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
      expect(() => validateEnv({ [name]: value })).toThrow(new Error(`Invalid env: ${name}`));
    });

    it('never puts the value in the error', () => {
      expect(() => validateEnv({ [name]: 'postgresql://u:hunter2@h:bad/db' })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
      );
    });
  });
});
