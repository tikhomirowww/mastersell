import { Public } from '../../auth/decorators';
import { Controller, Post, Body, Param, HttpCode, Logger } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { CrmService } from '../../crm/crm.service';

interface GreenApiWebhook {
  typeWebhook: string;
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
    private readonly whatsapp: WhatsAppService,
    private readonly crm: CrmService,
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

    if (msgType === 'textMessage' && body.messageData?.textMessageData?.textMessage) {
      const text = body.messageData.textMessageData.textMessage;
      this.whatsapp
        .handleIncoming(instanceId, tenant.token, tenant.tenantId, phone, text, name)
        .catch((err) => this.logger.error('Error handling WhatsApp text', err));

    } else if (msgType === 'audioMessage' && body.messageData?.fileMessageData?.downloadUrl) {
      const downloadUrl = body.messageData.fileMessageData.downloadUrl;
      this.whatsapp
        .handleIncomingAudio(instanceId, tenant.token, tenant.tenantId, phone, downloadUrl, name)
        .catch((err) => this.logger.error('Error handling WhatsApp audio', err));
    }

    return 'ok';
  }
}
