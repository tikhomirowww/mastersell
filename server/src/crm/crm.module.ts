import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { SettingsController } from './settings.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [CrmController, SettingsController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
