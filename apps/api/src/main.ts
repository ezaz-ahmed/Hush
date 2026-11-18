import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

const PORT = 5555; // shortcut: hardcoded, moves to ConfigService in the next task.

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
await app.listen(PORT, 'localhost');
