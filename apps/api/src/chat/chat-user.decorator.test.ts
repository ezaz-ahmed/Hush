import { Controller, Get, UseGuards } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatUserId } from './chat-user.decorator.js';
import { TestUserGuard } from './testing/test-user.guard.js';

const USER_ID = '7b1f4c2e-5d3a-4e8b-9c1d-2a6f8e0b4d37';

@Controller('whoami')
class WhoAmIController {
  @Get()
  whoami(@ChatUserId() userId: string) {
    return { userId };
  }
}

@Controller('guarded')
@UseGuards(TestUserGuard)
class GuardedController {
  @Get()
  whoami(@ChatUserId() userId: string) {
    return { userId };
  }
}

describe('@ChatUserId', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WhoAmIController, GuardedController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  it('returns the id the test guard set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-test-user': USER_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: USER_ID });
  });

  it('is 401 when no guard set a user id', async () => {
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    expect(res.statusCode).toBe(401);
  });

  it('is 401 when the guard-set id is not a uuid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-test-user': 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is 401 when the test guard header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(401);
  });
});
