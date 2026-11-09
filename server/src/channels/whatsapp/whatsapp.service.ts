import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SalesService } from '../../agents/sales/sales.service';
import { CrmService } from '../../crm/crm.service';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly deepgramApiKey: string;
  private readonly greenApiBase: string;

  constructor(
    private readonly config: ConfigService,
    private readonly sales: SalesService,
    private readonly crm: CrmService,
  ) {
    this.deepgramApiKey = this.config.get<string>('deepgram.apiKey') ?? '';
    this.greenApiBase = this.config.get<string>('greenApi.baseUrl') ?? 'https://api.green-api.com';
  }

  /**
   * Обрабатывает входящее текстовое сообщение от GreenAPI
   */
  async handleIncoming(
    instanceId: string,
    apiToken: string,
    tenantId: string,
    phone: string,
    text: string,
    name?: string,
    opts: { canRetry?: boolean } = {},
  ): Promise<void> {
    this.logger.log(`Incoming WhatsApp from ${phone} (instance=${instanceId}): ${text}`);

    const contact = await this.crm.upsertContact(tenantId, { phone, name });

    let reply;
    try {
      reply = await this.sales.handle({
        sessionId: `wa:${phone}`,
        contactId: contact.id,
        tenantId,
        channel: 'WHATSAPP',
        language: contact.language,
        text,
      });
    } catch (err) {
      if (opts.canRetry) throw err;
      this.logger.error(`Sales agent failed for ${phone}`, err);
      await this.sendMessage(instanceId, apiToken, phone, 'Секунду, сейчас уточню информацию и вернусь к вам 🙏');
      return;
    }

    await this.crm.saveMessage(contact.id, 'WHATSAPP', text, reply.text, reply.tokensUsed);

    if (reply.intent === 'READY_TO_BUY') {
      await this.crm.updateStage(contact.id, 'NEGOTIATING');
    }

    await this.sendMessage(instanceId, apiToken, phone, reply.text);
  }

  /**
   * Обрабатывает входящее аудио сообщение от GreenAPI
   */
  async handleIncomingAudio(
    instanceId: string,
    apiToken: string,
    tenantId: string,
    phone: string,
    downloadUrl: string,
    name?: string,
    opts: { canRetry?: boolean } = {},
  ): Promise<void> {
    this.logger.log(`Incoming WhatsApp audio from ${phone}, url=${downloadUrl}`);

    if (!this.deepgramApiKey) {
      await this.sendMessage(instanceId, apiToken, phone, 'Извините, голосовые сообщения пока не поддерживаются. Напишите текстом 🙏');
      return;
    }

    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) {
      this.logger.error(`Failed to download audio: ${audioRes.status}`);
      await this.sendMessage(instanceId, apiToken, phone, 'Не удалось обработать голосовое сообщение. Напишите текстом 🙏');
      return;
    }

    const audioBuffer = await audioRes.arrayBuffer();
    const text = await this.transcribeAudio(audioBuffer);

    if (!text) {
      await this.sendMessage(instanceId, apiToken, phone, 'Не удалось распознать голосовое сообщение. Попробуйте написать текстом 🙏');
      return;
    }

    this.logger.log(`Transcribed audio from ${phone}: ${text}`);
    await this.handleIncoming(instanceId, apiToken, tenantId, phone, text, name, opts);
  }

  /**
   * Отправляет текстовое сообщение через GreenAPI
   */
  async sendMessage(instanceId: string, apiToken: string, phone: string, text: string): Promise<void> {
    const chatId = this.toChatId(phone);
    const url = `${this.greenApiBase}/waInstance${instanceId}/sendMessage/${apiToken}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: text }),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`GreenAPI send failed: ${err}`);
      throw new Error(`GreenAPI error: ${err}`);
    }

    this.logger.log(`Message sent to ${phone}`);
  }

  /**
   * Транскрибирует аудио через Deepgram
   */
  private async transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
    const res = await fetch(`${DEEPGRAM_API_URL}?language=ru&model=nova-2&smart_format=true`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.deepgramApiKey}`,
        'Content-Type': 'audio/ogg',
      },
      body: audioBuffer,
    });

    if (!res.ok) {
      this.logger.error(`Deepgram error: ${await res.text()}`);
      return '';
    }

    const data = (await res.json()) as {
      results: { channels: Array<{ alternatives: Array<{ transcript: string }> }> };
    };

    return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  }

  /**
   * Конвертирует номер телефона в формат GreenAPI chatId
   * +79001234567 → 79001234567@c.us
   */
  private toChatId(phone: string): string {
    return phone.replace(/^\+/, '') + '@c.us';
  }

  /**
   * Извлекает номер телефона из GreenAPI chatId
   * 79001234567@c.us → +79001234567
   */
  static fromChatId(chatId: string): string {
    return '+' + chatId.replace('@c.us', '');
  }
}
