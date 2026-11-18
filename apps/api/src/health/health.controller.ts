import { Controller, Get } from '@nestjs/common';
import { health, type HealthStatus } from '@hush/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return health('api');
  }
}
