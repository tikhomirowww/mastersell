import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppProcessor } from './whatsapp.processor';
import { IdempotencyService } from '../../lib/idempotency/idempotency.service';
import { WHATSAPP_INCOMING_QUEUE } from './whatsapp.queue';

@Module({
  imports: [
    BullModule.registerQueue({
      name: WHATSAPP_INCOMING_QUEUE,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppProcessor, IdempotencyService],
})
export class WhatsAppModule {}
