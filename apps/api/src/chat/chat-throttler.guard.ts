import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerOptions,
} from '@nestjs/throttler';
import type { RateLimitError } from '@hush/shared';
import type { FastifyRequest } from 'fastify';
import { userIdSchema } from './chat-user.decorator.js';

const WINDOW_MS = 60_000;

const requestOf = (ctx: ExecutionContext) => ctx.switchToHttp().getRequest<FastifyRequest>();

/**
 * `ip` uses the library default tracker (req.ip). `user` is keyed by chatUserId and skipped when
 * it is not a valid uuid, so junk never becomes a key. `setHeaders: false` keeps the library from
 * sending Retry-After-<name> and X-RateLimit-* headers.
 */
export function chatThrottlers(limits: { perIp: number; perUser: number }): ThrottlerOptions[] {
  return [
    { name: 'ip', limit: limits.perIp, ttl: WINDOW_MS, setHeaders: false },
    {
      name: 'user',
      limit: limits.perUser,
      ttl: WINDOW_MS,
      setHeaders: false,
      getTracker: (req) => String(req['chatUserId']),
      skipIf: (ctx) => !userIdSchema.safeParse(requestOf(ctx).chatUserId).success,
    },
  ];
}

@Injectable()
export class ChatThrottlerGuard extends ThrottlerGuard {
  // Body and header carry only the wait time: no tracker, key or limit name (rule 2).
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfter = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    this.setResponseHeader(context.switchToHttp().getResponse(), 'Retry-After', retryAfter);
    const body: RateLimitError = {
      statusCode: 429,
      error: 'Too Many Requests',
      retryAfter,
    };
    throw new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
  }
}
