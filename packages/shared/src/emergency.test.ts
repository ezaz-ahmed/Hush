import { describe, expect, it } from 'vitest';
import { EMERGENCY_NUMBER } from './emergency.js';

describe('EMERGENCY_NUMBER', () => {
  it('is the Bangladesh national emergency number', () => {
    expect(EMERGENCY_NUMBER).toBe('999');
  });
});
