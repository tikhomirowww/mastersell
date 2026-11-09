import { Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { CrmService } from '../../crm/crm.service';
import { IdempotencyService } from '../../lib/idempotency/idempotency.service';
import { WhatsAppService } from './whatsapp.service';
import { WHATSAPP_INCOMING_QUEUE, WhatsAppIncomingJob } from './whatsapp.queue';

@Processor(WHATSAPP_INCOMING_QUEUE)
export class WhatsAppProcessor {
  private readonly logger = new Logger(WhatsAppProcessor.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly crm: CrmService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Process({ concurrency: 5 })
  async handle(job: Job<WhatsAppIncomingJob>): Promise<void> {
    const data = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    this.logger.log(`job ${data.key}: attempt ${attempt}/${maxAttempts}`);

    const tenant = await this.crm.getTenantByGreenApiInstance(data.instanceId);
    if (!tenant) {
      this.logger.warn(`job ${data.key}: unknown GreenAPI instance ${data.instanceId}, dropped`);
      await this.idempotency.complete(data.key);
      return;
    }

    const opts = { canRetry: attempt < maxAttempts };
    if (data.kind === 'text') {
      await this.whatsapp.handleIncoming(data.instanceId, tenant.token, tenant.tenantId, data.phone, data.text, data.name, opts);
    } else {
      await this.whatsapp.handleIncomingAudio(data.instanceId, tenant.token, tenant.tenantId, data.phone, data.downloadUrl, data.name, opts);
    }

    await this.idempotency.complete(data.key);
  }

  @OnQueueFailed()
  onFailed(job: Job<WhatsAppIncomingJob>, err: Error) {
    const left = (job.opts.attempts ?? 1) - job.attemptsMade;
    this.logger.warn(`job ${job.data.key}: failed (${err.message}), retries left: ${left}`);
  }
}
