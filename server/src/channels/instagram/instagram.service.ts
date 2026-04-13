import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SalesService } from '../../agents/sales/sales.service';
import { CrmService } from '../../crm/crm.service';
import { MetaMessagingEvent } from './dto/instagram-webhook.dto';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly pageAccessToken: string;

  constructor(
    private readonly config: ConfigService,
    private readonly sales: SalesService,
    private readonly crm: CrmService,
  ) {
    this.pageAccessToken = this.config.get<string>('meta.instagramAccessToken') ?? '';
  }

  async handleMessage(event: MetaMessagingEvent): Promise<void> {
    // Игнорируем echo (сообщения отправленные самой страницей)
    if (event.message?.is_echo) return;
    if (!event.message?.text) return;

    const senderId = event.sender.id;
    const text = event.message.text;
    this.logger.log(`Incoming Instagram DM from ${senderId}: ${text}`);

    // Instagram пока без multi-tenant роутинга — используем default
    const tenantId = 'default-tenant';
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
      await this.crm.updateStage(contact.id, 'NEGOTIATING');
    }

    await this.sendReply(senderId, reply.text);
  }

  async sendReply(recipientId: string, text: string): Promise<void> {
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${this.pageAccessToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
