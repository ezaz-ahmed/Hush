import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({
  name: z.string().trim(),
  age: z.number().int().default(30),
});

// Kept outside the assertions so a regression reports "expected the pipe to throw", not a TypeError.
const errorOf = (fn: () => unknown): BadRequestException => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BadRequestException) return e;
    throw e;
  }
  throw new Error('expected the pipe to throw');
};

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed data, applying defaults and transforms', () => {
    expect(pipe.transform({ name: '  Ada  ' })).toEqual({ name: 'Ada', age: 30 });
  });

  it('throws BadRequestException listing only paths and codes', () => {
    // toEqual, not toMatchObject: any extra field (zod's message, the input) must fail this.
    expect(errorOf(() => pipe.transform({ name: 1, age: 'x' })).getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: [
        { path: ['name'], code: 'invalid_type' },
        { path: ['age'], code: 'invalid_type' },
      ],
    });
  });

  it('turns symbol path segments into strings so the body stays JSON-safe', () => {
    const withSymbol = new ZodValidationPipe(
      z.any().superRefine((_value, ctx) => {
        ctx.addIssue({ code: 'custom', path: [Symbol('k'), 0] });
      }),
    );
    expect(errorOf(() => withSymbol.transform({})).getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: [{ path: ['Symbol(k)', 0], code: 'custom' }],
    });
  });

  it('never echoes input that zod puts in its own message', () => {
    // zod's unrecognized_keys message quotes the key, so this leaks if messages are passed through.
    const pii = 'jane.doe@example.com';
    const strict = new ZodValidationPipe(z.object({ name: z.string() }).strict());
    const error = errorOf(() => strict.transform({ name: 'ok', [pii]: 1 }));
    expect(JSON.stringify(error.getResponse())).not.toContain(pii);
  });
});
