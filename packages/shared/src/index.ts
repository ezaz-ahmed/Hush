export type HealthStatus = { ok: boolean; service: string };

export const health = (service: string): HealthStatus => ({ ok: true, service });
