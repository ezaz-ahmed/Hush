import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { rateLimitErrorSchema } from '@hush/shared';
import { describe, expect, it, vi } from 'vitest';
import { ChatThrottlerGuard, chatThrottlers } from './chat-throttler.guard.js';

const USER_ID = '7b1f4c2e-5d3a-4e8b-9c1d-2a6f8e0b4d37';

const ctxFor = (req: Record<string, unknown>, res: Record<string, unknown> = {}) =>
  ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) }) as ExecutionContext;

describe('chatThrottlers', () => {
  const [ip, user] = chatThrottlers({ perIp: 30, perUser: 10 });
  if (!ip || !user) throw new Error('expected two throttlers');

  it('builds an ip and a user throttler with a 60 s window', () => {
    expect(ip).toMatchObject({ name: 'ip', limit: 30, ttl: 60_000, setHeaders: false });
    expect(user).toMatchObject({ name: 'user', limit: 10, ttl: 60_000, setHeaders: false });
  });

  it('leaves the ip tracker to the library default', () => {
    expect(ip.getTracker).toBeUndefined();
    expect(ip.skipIf).toBeUndefined();
  });

  it('tracks the user throttler by chatUserId', async () => {
    const ctx = ctxFor({});
    expect(await user.getTracker?.({ chatUserId: USER_ID }, ctx)).toBe(USER_ID);
  });

  it.each([
    ['absent', undefined],
    ['not a string', 42],
    ['not a uuid', 'alice'],
  ])('skips the user throttler when chatUserId is %s', async (_label, chatUserId) => {
    expect(await user.skipIf?.(ctxFor({ chatUserId }))).toBe(true);
  });

  it('does not skip the user throttler for a valid uuid', async () => {
    expect(await user.skipIf?.(ctxFor({ chatUserId: USER_ID }))).toBe(false);
  });
});

describe('ChatThrottlerGuard.throwThrottlingException', () => {
  const guard = new ChatThrottlerGuard(
    chatThrottlers({ perIp: 1, perUser: 1 }),
    new ThrottlerStorageService(),
    new Reflector(),
  );
  const throwFn = (ctx: ExecutionContext, detail: Partial<ThrottlerLimitDetail>) =>
    (
      guard as unknown as {
        throwThrottlingException(c: ExecutionContext, d: unknown): Promise<void>;
      }
    ).throwThrottlingException(ctx, detail);

  it('sets Retry-After and throws a 429 with the shared body, without tracker data', async () => {
    const header = vi.fn();
    const detail = { timeToBlockExpire: 42, tracker: '203.0.113.9', key: 'secret-key' };
    const err: unknown = await throwFn(ctxFor({}, { header }), detail).catch((e: unknown) => e);

    expect(header).toHaveBeenCalledWith('Retry-After', 42);
    expect(err).toBeInstanceOf(HttpException);
    const { status, body } = {
      status: (err as HttpException).getStatus(),
      body: (err as HttpException).getResponse(),
    };
    expect(status).toBe(429);
    expect(rateLimitErrorSchema.parse(body)).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      retryAfter: 42,
    });
    expect(JSON.stringify(body)).not.toContain('203.0.113.9');
  });
});
