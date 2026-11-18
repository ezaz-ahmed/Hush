import { health, type HealthStatus } from '@hush/shared';

export const status = (): HealthStatus => health('web');
