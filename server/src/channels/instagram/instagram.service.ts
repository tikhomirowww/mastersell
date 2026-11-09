import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SalesService } from '../../agents/sales/sales.service';
import { CrmService } from '../../crm/crm.service';
import { MetaMessagingEvent } from './dto/instagram-webhook.dto';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly graphBaseUrl: string;

  constructor(
    config: ConfigService,
    private readonly sales: SalesService,
    private readonly crm: CrmService,
  ) {
    this.graphBaseUrl = config.get<string>('meta.graphBaseUrl')!;
  }

  async handleMessage(event: MetaMessagingEvent): Promise<void> {
    // Игнорируем echo (сообщения отправленные самой страницей)
    if (event.message?.is_echo) return;
    if (!event.message?.text) return;

    const senderId = event.sender.id;
    const text = event.message.text;
    this.logger.log(`Incoming Instagram DM from ${senderId}: ${text}`);

    const tenant = await this.crm.getTenantByInstagramAccount(event.recipient.id);
    if (!tenant) {
      this.logger.warn(`Instagram DM to unknown account ${event.recipient.id}, dropped`);
      return;
    }
    const { tenantId } = tenant;
    const contact = await this.crm.upsertContact(tenantId, { instagramId: senderId });

    const reply = await this.sales.handle({
      sessionId: `ig:${senderId}`,
      contactId: contact.id,
      tenantId,
      channel: 'INSTAGRAM',
      language: contact.language,
      text,
    });

    await this.crm.saveMessage(contact.id, 'INSTAGRAM', text, reply.text, reply.tokensUsed);

    if (reply.intent === 'READY_TO_BUY') {
      await this.crm.updateStage(tenantId, contact.id, 'NEGOTIATING');
    }

    await this.sendReply(tenant.token, senderId, reply.text);
  }

  async sendReply(accessToken: string, recipientId: string, text: string): Promise<void> {
    const response = await fetch(`${this.graphBaseUrl}/v19.0/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      this.logger.error(`Failed to send Instagram reply: ${err}`);
    }
  }
}
