import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by an upstream identity guard (#41); unvalidated until `@ChatUserId()` reads it. */
    chatUserId?: unknown;
  }
}

/** The one rule for a valid chat user id; shared with the chat throttler. */
export const userIdSchema = z.uuid();

/** Reads the user id set by a guard; 401 if absent or malformed. */
export const ChatUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const parsed = userIdSchema.safeParse(ctx.switchToHttp().getRequest<FastifyRequest>().chatUserId);
  if (!parsed.success) throw new UnauthorizedException();
  return parsed.data;
});
