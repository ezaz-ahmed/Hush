import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import '../chat-user.decorator.js'; // brings in the chatUserId augmentation

/** Test-only stand-in for the identity guard (#41): copies `x-test-user` to `chatUserId`. */
export class TestUserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers['x-test-user'];
    if (typeof header === 'string') req.chatUserId = header;
    return true;
  }
}
