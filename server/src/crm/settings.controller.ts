import {
  Controller, Get, Put, Post, Delete, Body,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { unlink } from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { CrmService } from './crm.service';
import { ClaudeService, ClaudeMessage } from '../lib/claude/claude.service';
import { TenantId } from '../auth/decorators';

// Системный промпт для онбординг-чата
const ONBOARDING_SYSTEM = `Ты помощник по настройке AI-менеджера по продажам. Твоя единственная задача — собрать информацию о бизнесе клиента для настройки агента. Задавай вопросы по одному, дружелюбно, по-русски.

Собери информацию по этим темам (веди естественный диалог, не анкету):
- Чем занимается бизнес, какие товары или услуги
- Ассортимент и основные позиции
- Цены (хотя бы диапазон или примеры)
- Адрес и режим работы
- Доставка: есть ли, условия, стоимость
- Оплата: наличные, карта, рассрочка, кредит
- Частые вопросы от клиентов и ответы на них

ВАЖНЫЕ ПРАВИЛА:
1. Ты НЕ консультант, НЕ советник, НЕ собеседник на свободные темы. Ты ТОЛЬКО собираешь данные о бизнесе.
2. Если клиент пытается говорить о посторонних темах (политика, личное, другие вопросы) — мягко, но твёрдо возвращай к теме: "Давайте вернёмся к настройке вашего агента. Расскажите мне о..."
3. Не давай советов по бизнесу, не оценивай решения клиента, не обсуждай конкурентов.
4. Не придумывай информацию — записывай только то, что сказал клиент.
5. Как только соберёшь достаточно по всем темам — скажи об этом и предложи сгенерировать контекст.`;

// Промпт для генерации финального контекста
const GENERATE_CONTEXT_SYSTEM = `На основе диалога ниже сформируй структурированный контекст для AI-менеджера по продажам.
Пиши кратко, по делу, только факты из разговора. Формат — обычный текст с разделами.
Не придумывай ничего, чего не было в диалоге. Пиши на русском языке.`;

// Промпт для структурированной экстракции полей из диалога
const EXTRACT_FIELDS_SYSTEM = `Из диалога извлеки информацию о бизнесе. Верни ТОЛЬКО валидный JSON без markdown и пояснений:
{"products":null,"prices":null,"address":null,"hours":null,"delivery":null,"payment":null,"faq":null}

Заполни поля которые упоминались. null — если не упоминалось. Пиши кратко, только факты, на русском языке.`;

class UpdateProfileDto {
  name?: string;
  agentContext?: string;
}

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly crm: CrmService,
    private readonly claude: ClaudeService,
    private readonly config: ConfigService,
  ) {}

  @Get('profile')
  getProfile(@TenantId() tenantId: string) {
    return this.crm.getBusinessProfile(tenantId);
  }

  @Put('profile')
  updateProfile(@TenantId() tenantId: string, @Body() body: UpdateProfileDto) {
    return this.crm.updateBusinessProfile(tenantId, body);
  }

  // ─── Чат-онбординг ───────────────────────────────────────────────────────────

  /** Следующее сообщение агента в онбординг-чате */
  @Post('onboarding/chat')
  async onboardingChat(
    @Body('messages') messages: ClaudeMessage[],
  ): Promise<{ reply: string }> {
    if (!messages?.length) {
      // Первое сообщение — агент начинает сам
      const res = await this.claude.chat(
        ONBOARDING_SYSTEM,
        [{ role: 'user', content: 'Начни собирать информацию о моём бизнесе.' }],
        400,
      );
      return { reply: res.content };
    }
    const res = await this.claude.chat(ONBOARDING_SYSTEM, messages, 400);
    return { reply: res.content };
  }

  /** Экстракция структурированных полей из диалога (без сохранения) */
  @Post('onboarding/extract')
  async extractFields(
    @Body('messages') messages: ClaudeMessage[],
  ): Promise<{ fields: Record<string, string | null> }> {
    const empty = { products: null, prices: null, address: null, hours: null, delivery: null, payment: null, faq: null };
    if (!messages?.length) return { fields: empty };

    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'Клиент' : 'Агент'}: ${m.content}`)
      .join('\n');

    const res = await this.claude.chat(
      EXTRACT_FIELDS_SYSTEM,
      [{ role: 'user', content: transcript }],
      800,
    );

    try {
      const cleaned = res.content.replace(/```json\n?|\n?```/g, '').trim();
      return { fields: JSON.parse(cleaned) };
    } catch {
      return { fields: empty };
    }
  }

  /** Автосохранение истории чата (вызывается после каждого ответа ассистента) */
  @Put('onboarding/history')
  async saveHistory(
    @TenantId() tenantId: string,
    @Body('messages') messages: ClaudeMessage[],
  ): Promise<{ ok: boolean }> {
    await this.crm.updateBusinessProfile(tenantId, {
      chatHistory: JSON.stringify(messages),
    });
    return { ok: true };
  }

  /** Генерация финального контекста из диалога и сохранение */
  @Post('onboarding/finish')
  async onboardingFinish(
    @TenantId() tenantId: string,
    @Body('messages') messages: ClaudeMessage[],
  ): Promise<{ agentContext: string }> {
    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'Клиент' : 'Агент'}: ${m.content}`)
      .join('\n');

    const res = await this.claude.chat(
      GENERATE_CONTEXT_SYSTEM,
      [{ role: 'user', content: transcript }],
      1000,
    );

    const agentContext = res.content;
    await this.crm.updateBusinessProfile(tenantId, { agentContext });
    return { agentContext };
  }

  // ─── Загрузка документа ──────────────────────────────────────────────────────

  /** Загрузка PDF или Word → парсинг → Claude генерирует контекст → сохраняет */
  @Post('onboarding/document')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];
        if (!allowed.includes(file.mimetype)) {
          cb(new BadRequestException('Поддерживаются PDF, Word, TXT'), false);
        } else {
          cb(null, true);
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  async uploadDocument(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ agentContext: string }> {
    if (!file) throw new BadRequestException('Файл не загружен');

    let text = '';

    if (file.mimetype === 'application/pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(file.buffer);
      text = parsed.text;
    } else if (file.mimetype === 'text/plain') {
      text = file.buffer.toString('utf-8');
    } else {
      // Word (.doc / .docx)
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    }

    if (!text.trim()) throw new BadRequestException('Не удалось извлечь текст из документа');

    // Ограничиваем чтобы не превысить контекст
    const truncated = text.slice(0, 12000);

    const res = await this.claude.chat(
      `Ты помощник по настройке AI-менеджера. На основе предоставленного документа сформируй структурированный контекст для AI-агента продаж.
Извлеки: товары/услуги, цены, адрес, режим работы, условия доставки, оплата, FAQ.
Пиши кратко и только по делу. Русский язык.`,
      [{ role: 'user', content: `Документ:\n\n${truncated}` }],
      1500,
    );

    const agentContext = res.content;
    await this.crm.updateBusinessProfile(tenantId, { agentContext });
    return { agentContext };
  }

  // ─── Транскрипция голоса ─────────────────────────────────────────────────────

  @Post('onboarding/transcribe')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async transcribe(@UploadedFile() file: Express.Multer.File): Promise<{ transcript: string }> {
    if (!file) throw new BadRequestException('Аудио не загружено');
    const apiKey = this.config.get<string>('DEEPGRAM_API_KEY');
    const res = await fetch(
      'https://api.deepgram.com/v1/listen?language=ru&model=nova-2&punctuate=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': file.mimetype || 'audio/webm',
        },
        body: file.buffer as any,
      },
    );
    const data = await res.json();
    const transcript: string =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return { transcript };
  }

  // ─── WhatsApp / GreenAPI интеграция ─────────────────────────────────────────

  private greenApiUrl(instanceId: string, token: string, method: string) {
    return `https://api.green-api.com/waInstance${instanceId}/${method}/${token}`;
  }

  private get partnerToken(): string {
    return this.config.get<string>('greenApi.partnerToken') ?? '';
  }

  /** Статус подключения текущего тенанта */
  @Get('whatsapp')
  async getWhatsApp(@TenantId() tenantId: string) {
    const profile = await this.crm.getBusinessProfile(tenantId);
    const instanceId = profile.greenApiInstanceId ?? null;

    if (!instanceId || !profile.greenApiToken) {
      return { connected: false, instanceId: null };
    }

    try {
      const res = await fetch(
        this.greenApiUrl(instanceId, profile.greenApiToken, 'getStateInstance'),
      );
      const data = (await res.json()) as { stateInstance: string };
      return {
        connected: data.stateInstance === 'authorized',
        stateInstance: data.stateInstance,
        instanceId,
      };
    } catch {
      return { connected: false, instanceId, stateInstance: 'error' };
    }
  }

  /** Сохранить credentials вручную + выставить webhook */
  @Put('instagram')
  async saveInstagram(
    @TenantId() tenantId: string,
    @Body() body: { accountId: string; accessToken: string },
  ) {
    if (!body.accountId?.trim() || !body.accessToken?.trim()) {
      throw new BadRequestException('accountId и accessToken обязательны');
    }
    await this.crm.updateBusinessProfile(tenantId, {
      instagramAccountId: body.accountId.trim(),
      instagramAccessToken: body.accessToken.trim(),
    });
    return { ok: true };
  }

  @Put('whatsapp')
  async saveWhatsApp(
    @TenantId() tenantId: string,
    @Body() body: { instanceId: string; apiToken: string },
  ) {
    if (!body.instanceId?.trim() || !body.apiToken?.trim()) {
      throw new BadRequestException('instanceId и apiToken обязательны');
    }

    const instanceId = body.instanceId.trim();
    const apiToken = body.apiToken.trim();
    const baseUrl = this.config.get<string>('app.baseUrl') ?? '';
    const webhookUrl = `${baseUrl}/webhooks/whatsapp`;

    await this.crm.updateBusinessProfile(tenantId, {
      greenApiInstanceId: instanceId,
      greenApiToken: apiToken,
    });

    await fetch(this.greenApiUrl(instanceId, apiToken, 'setSettings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl,
        outgoingWebhook: 'yes',
        incomingWebhook: 'yes',
        outgoingMessageWebhook: 'yes',
      }),
    }).catch(() => {});

    return { ok: true };
  }

  /**
   * Создаёт новый инстанс через Partner API и возвращает QR-код.
   * Клиент не вводит никаких данных — всё происходит автоматически.
   */
  @Post('whatsapp/connect')
  async connectWhatsApp(@TenantId() tenantId: string) {
    if (!this.partnerToken) {
      throw new BadRequestException('GreenAPI Partner Token не настроен');
    }

    const baseUrl = this.config.get<string>('app.baseUrl') ?? '';
    const webhookUrl = `${baseUrl}/webhooks/whatsapp`;

    // Создаём инстанс через Partner API
    const createRes = await fetch(
      `https://api.green-api.com/partner/createInstance/${this.partnerToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl,
          outgoingWebhook: 'yes',
          incomingWebhook: 'yes',
          outgoingMessageWebhook: 'yes',
        }),
      },
    );

    if (!createRes.ok) {
      throw new BadRequestException(`GreenAPI error: ${await createRes.text()}`);
    }

    const instance = (await createRes.json()) as {
      idInstance: number;
      apiTokenInstance: string;
    };

    const instanceId = String(instance.idInstance);
    const apiToken = instance.apiTokenInstance;

    // Сохраняем в БД
    await this.crm.updateBusinessProfile(tenantId, {
      greenApiInstanceId: instanceId,
      greenApiToken: apiToken,
    });

    // Сразу получаем QR
    const qrRes = await fetch(this.greenApiUrl(instanceId, apiToken, 'qr'));
    const qr = (await qrRes.json()) as { type: string; message: string };

    return { instanceId, qr };
  }

  /** Проксируем свежий QR-код от GreenAPI */
  @Get('whatsapp/qr')
  async getWhatsAppQr(@TenantId() tenantId: string) {
    const profile = await this.crm.getBusinessProfile(tenantId);
    if (!profile.greenApiInstanceId || !profile.greenApiToken) {
      throw new BadRequestException('WhatsApp не инициализирован');
    }

    const res = await fetch(
      this.greenApiUrl(profile.greenApiInstanceId, profile.greenApiToken, 'qr'),
    );
    return (await res.json()) as { type: string; message: string };
  }

  /** Отключить WhatsApp — удаляем инстанс через Partner API */
  @Delete('whatsapp')
  async disconnectWhatsApp(@TenantId() tenantId: string) {
    const profile = await this.crm.getBusinessProfile(tenantId);

    if (profile.greenApiInstanceId && this.partnerToken) {
      await fetch(`https://api.green-api.com/partner/deleteInstance/${this.partnerToken}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idInstance: Number(profile.greenApiInstanceId) }),
      }).catch(() => {});
    }

    await this.crm.updateBusinessProfile(tenantId, {
      greenApiInstanceId: null as any,
      greenApiToken: null as any,
    });

    return { ok: true };
  }

  // ─── Компания ────────────────────────────────────────────────────────────────

  @Put('company')
  async updateCompany(@TenantId() tenantId: string, @Body() body: { name?: string }) {
    if (!body.name?.trim()) throw new BadRequestException('Название не может быть пустым');
    await this.crm.tenant.update({ where: { id: tenantId }, data: { name: body.name.trim() } });
    return { ok: true };
  }

  @Post('company/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(__dirname, '..', '..', 'public', 'uploads'),
        filename: (_req, file, cb) => {
          const tenantId = (_req as any).user?.tenantId ?? 'unknown';
          cb(null, `tenant_${tenantId}_${Date.now()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\//)) {
          cb(new BadRequestException('Только изображения'), false);
        } else {
          cb(null, true);
        }
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadLogo(@TenantId() tenantId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не загружен');
    const serverUrl = this.config.get<string>('SERVER_URL') ?? 'http://localhost:3001';
    const uploadsPrefix = `${serverUrl}/public/uploads/`;

    const tenant = await this.crm.tenant.findUnique({ where: { id: tenantId } });
    if (tenant?.logoUrl?.startsWith(uploadsPrefix)) {
      const oldFilename = tenant.logoUrl.slice(uploadsPrefix.length);
      await unlink(join(__dirname, '..', '..', 'public', 'uploads', oldFilename)).catch(() => {});
    }

    const logoUrl = `${uploadsPrefix}${file.filename}`;
    await this.crm.tenant.update({ where: { id: tenantId }, data: { logoUrl } });
    return { logoUrl };
  }
}
