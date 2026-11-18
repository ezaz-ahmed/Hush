import type { ValidationIssue } from '@hush/shared';
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Use per handler: @Body(new ZodValidationPipe(schema)). */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    // Only paths and codes: never echo the input back (it may hold PII).
    if (!result.success) {
      const issues: ValidationIssue[] = result.error.issues.map(({ path, code }) => ({
        // Symbols can't be JSON; zod's PropertyKey path type allows them.
        path: path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
        code,
      }));
      throw new BadRequestException(issues);
    }
    return result.data;
  }
}
