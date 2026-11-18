import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('defaults PORT to 5555', () => {
    expect(validateEnv({})).toEqual({ PORT: 5555 });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ PORT: '6000' })).toEqual({ PORT: 6000 });
  });

  it.each(['abc', '0', '70000'])('rejects PORT=%s and names PORT', (PORT) => {
    expect(() => validateEnv({ PORT })).toThrow(/PORT/);
  });

  it('never puts env values in the error', () => {
    expect(() => validateEnv({ PORT: 'abc', SECRET: 'hunter2' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
    expect(() => validateEnv({ PORT: 'hunter2' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
  });
});
