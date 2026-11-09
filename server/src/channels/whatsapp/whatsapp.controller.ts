import { Public } from '../../auth/decorators';
import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { WhatsAppService } from './whatsapp.service';
import { CrmService } from '../../crm/crm.service';
import { IdempotencyService } from '../../lib/idempotency/idempotency.service';
import { WHATSAPP_INCOMING_QUEUE, WhatsAppIncomingJob } from './whatsapp.queue';

interface GreenApiWebhook {
  typeWebhook: string;
  idMessage?: string;
  instanceData: {
    idInstance: number;
  };
  senderData?: {
    chatId: string;
    senderName?: string;
  };
  messageData?: {
    typeMessage: string;
    textMessageData?: { textMessage: string };
    fileMessageData?: { downloadUrl: string; mimeType: string };
  };
}

@Public()
@Controller('webhooks/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly crm: CrmService,
    private readonly idempotency: IdempotencyService,
    @InjectQueue(WHATSAPP_INCOMING_QUEUE) private readonly queue: Queue<WhatsAppIncomingJob>,
  ) {}

  /**
   * Вебхук от GreenAPI — все входящие события
   */
  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() body: GreenApiWebhook): Promise<string> {
    if (body.typeWebhook !== 'incomingMessageReceived') return 'ok';

    const instanceId = String(body.instanceData.idInstance);
    const tenant = await this.crm.getTenantByGreenApiInstance(instanceId);

    if (!tenant) {
      this.logger.warn(`Unknown GreenAPI instance: ${instanceId}`);
      return 'ok';
    }

    const chatId = body.senderData?.chatId;
    if (!chatId) return 'ok';

    const phone = WhatsAppService.fromChatId(chatId);
    const name = body.senderData?.senderName;
    const msgType = body.messageData?.typeMessage;
    const text = body.messageData?.textMessageData?.textMessage;
    const downloadUrl = body.messageData?.fileMessageData?.downloadUrl;

    const key = `greenapi:${instanceId}:${body.idMessage}`;

    let job: WhatsAppIncomingJob | null = null;
    if (msgType === 'textMessage' && text) job = { kind: 'text', key, instanceId, phone, name, text };
    else if (msgType === 'audioMessage' && downloadUrl) job = { kind: 'audio', key, instanceId, phone, name, downloadUrl };
    if (!job) return 'ok';

    if (!body.idMessage) {
      this.logger.warn(`Webhook without idMessage from instance ${instanceId}, dropped`);
      return 'ok';
    }

    if (!(await this.idempotency.claim(key))) {
      this.logger.log(`Duplicate webhook ${key}, skipped`);
      return 'ok';
    }

    try {
      await this.queue.add(job, { jobId: key });
    } catch (err) {
      await this.idempotency.release(key);
      throw err;
    }

    return 'ok';
  }
}
