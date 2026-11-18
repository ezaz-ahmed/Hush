import { health } from '@hush/shared';

export const status = () => health('api');

// Stub entry point until NestJS lands; only logs when run directly, not when imported by tests.
if (import.meta.main) console.log(status());
