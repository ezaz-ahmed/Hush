import { health } from '@hush/shared';

export const status = () => health('web');

// Stub entry point until Next.js lands; only logs when run directly, not when imported by tests.
if (import.meta.main) console.log(status());
