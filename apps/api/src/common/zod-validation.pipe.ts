import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Use per handler: @Body(new ZodValidationPipe(schema)). */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    // Only paths and codes: never echo the input back (it may hold PII).
    if (!result.success)
      throw new BadRequestException(result.error.issues.map(({ path, code }) => ({ path, code })));
    return result.data;
  }
}
