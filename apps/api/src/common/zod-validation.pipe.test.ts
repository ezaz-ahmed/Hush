import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({
  name: z.string().trim(),
  age: z.number().int().default(30),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed data, applying defaults and transforms', () => {
    expect(pipe.transform({ name: '  Ada  ' })).toEqual({ name: 'Ada', age: 30 });
  });

  it('throws BadRequestException listing paths and codes', () => {
    try {
      pipe.transform({ name: 1, age: 'x' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({
        message: [
          { path: ['name'], code: 'invalid_type' },
          { path: ['age'], code: 'invalid_type' },
        ],
      });
    }
  });

  it('never echoes the submitted value in the error', () => {
    const pii = 'jane.doe@example.com';
    try {
      pipe.transform({ name: 'ok', age: pii });
      expect.unreachable();
    } catch (e) {
      expect(JSON.stringify((e as BadRequestException).getResponse())).not.toContain(pii);
    }
  });
});
