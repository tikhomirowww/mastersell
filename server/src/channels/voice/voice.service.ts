import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Language } from '@prisma/client';
import { SalesService } from '../../agents/sales/sales.service';
import { SessionService } from '../../memory/session.service';
import { CrmService } from '../../crm/crm.service';
import * as crypto from 'crypto';

@Injectable()
export class VoiceService implements OnModuleInit {
  private readonly logger = new Logger(VoiceService.name);

  // Временные аудио-буферы (удаляются через 2 мин)
  private readonly audioBuffers = new Map<string, Buffer>();

  // Постоянный кэш: приветствие + филлеры (никогда не удаляется)
  private readonly staticBuffers = new Map<string, Buffer>();

  // Кэш: phone → { tenantId, contactId, language } — убираем 2 DB-запроса из критического пути
  private readonly contactCache = new Map<string, { tenantId: string; contactId: string; language: Language }>();

  private greetingAudioUrl: string | undefined;
  private fillerAudioUrls: string[] = [];

  private static readonly FILLERS = [
    'Секунду.', 'Минуточку.', 'Сейчас.', 'Одну секунду.',
    'Секундочку.', 'Сейчас посмотрю.', 'Минуту.',
  ];

  constructor(
    private readonly config: ConfigService,
    private readonly sales: SalesService,
    private readonly session: SessionService,
    private readonly crm: CrmService,
  ) {}

  async onModuleInit() {
    const apiKey = this.config.get<string>('elevenlabs.apiKey');
    if (!apiKey) return;

    // Прегенерируем приветствие
    this.greetingAudioUrl = await this.generateStatic('Здравствуйте! Чем могу помочь?', 'static-greeting');

    // Прегенерируем все филлеры параллельно
    const urls = await Promise.all(
      VoiceService.FILLERS.map((text, i) => this.generateStatic(text, `static-filler-${i}`)),
    );
    this.fillerAudioUrls = urls.filter(Boolean) as string[];

    this.logger.log(`Pre-generated: greeting + ${this.fillerAudioUrls.length} fillers`);
  }

  /** Генерирует и кэширует статический аудио-файл (без таймаута удаления) */
  private async generateStatic(text: string, id: string): Promise<string | undefined> {
    const url = await this.generateAudio(text, id, true);
    return url;
  }

  /** Возвращает URL прегенерированного приветствия */
  getGreetingUrl(): string | undefined {
    return this.greetingAudioUrl;
  }

  /** Возвращает URL'ы всех прегенерированных филлеров для VoxEngine */
  getFillerUrls(): string[] {
    return this.fillerAudioUrls;
  }

  /**
   * Возвращает tenant+contact из кэша или делает DB-запрос (кэшируется на всё время жизни процесса)
   */
  private async resolveContact(phone: string): Promise<{ tenantId: string; contactId: string; language: Language }> {
    const key = phone || 'unknown';
    const cached = this.contactCache.get(key);
    if (cached) return cached;

    const tenantId = (await this.crm.getTenantIdByPhone('+996312963048')) ?? 'default-tenant';
    const contact = await this.crm.upsertContact(tenantId, { phone: key });
    const result = { tenantId, contactId: contact.id, language: contact.language };
    this.contactCache.set(key, result);
    this.logger.debug(`[Cache] resolved contact for ${key}: tenant=${tenantId}`);
    return result;
  }

  /**
   * Сохраняет приветствие в историю сессии, чтобы агент не здоровался повторно
   */
  async seedGreeting(callId: string, phone: string): Promise<void> {
    try {
      const { contactId, language } = await this.resolveContact(phone);
      await this.session.appendMessage(
        `voice:${callId}`,
        { role: 'assistant', content: 'Здравствуйте! Чем могу помочь?' },
        { contactId, channel: 'VOICE', language },
      );
    } catch (err) {
      this.logger.warn('Failed to seed greeting session', err);
    }
  }

  /**
   * Обрабатывает транскрипт от Voximplant и возвращает ответ агента
   */
  async handleTranscript(
    callId: string,
    phone: string,
    text: string,
  ): Promise<{ text: string; audioUrl?: string }> {
    this.logger.log(`[Voice] callId=${callId} from=${phone}: ${text}`);

    if (text?.trim() === '__greeting__') {
      const greeting = 'Здравствуйте! Чем могу помочь?';
      return { text: greeting, audioUrl: this.greetingAudioUrl };
    }

    if (!text?.trim()) {
      const fallback = 'Извините, не расслышал. Повторите, пожалуйста.';
      const audioUrl = await this.generateAudio(fallback, crypto.randomUUID());
      return { text: fallback, audioUrl };
    }

    const { tenantId, contactId, language } = await this.resolveContact(phone);

    const reply = await this.sales.handle({
      sessionId: `voice:${callId}`,
      contactId,
      tenantId,
      channel: 'VOICE',
      language,
      text,
    });

    if (reply.intent === 'READY_TO_BUY') {
      await this.crm.updateStage(tenantId, contactId, 'NEGOTIATING');
    }

    const audioUrl = await this.generateAudio(reply.text, crypto.randomUUID());
    return { text: reply.text, audioUrl };
  }

  /**
   * Стриминговая обработка транскрипта — pipeline TTS + Claude.
   * TTS-запросы стартуют немедленно при появлении предложения, не блокируя чтение Claude-стрима.
   * Claude генерирует S2 пока TTS(S1) уже в работе — первый чанк ~300-400мс.
   */
  async *handleTranscriptStream(
    callId: string,
    phone: string,
    text: string,
  ): AsyncGenerator<
    { type: 'chunk'; url: string; text: string } | { type: 'done'; intent: string }
  > {
    const { tenantId, contactId, language } = await this.resolveContact(phone);

    const incoming = {
      sessionId: `voice:${callId}`,
      contactId,
      tenantId,
      channel: 'VOICE' as const,
      language,
      text,
    };

    let sentenceBuffer = '';
    let intent = 'OTHER';

    // TTS-задачи стартуют сразу при появлении предложения — не ждём завершения
    const ttsQueue: Array<Promise<{ url: string | undefined; text: string }>> = [];

    for await (const event of this.sales.streamVoiceRaw(incoming)) {
      if (event.kind === 'text') {
        sentenceBuffer += event.chunk;
        const { sentences, remaining } = this.flushSentences(sentenceBuffer);
        sentenceBuffer = remaining;
        for (const sentence of sentences) {
          const id = crypto.randomUUID();
          ttsQueue.push(
            this.generateAudio(sentence, id).then(url => ({ url, text: sentence })),
          );
        }
      } else {
        // kind === 'done'
        intent = event.intent;
        if (sentenceBuffer.trim()) {
          const t = sentenceBuffer.trim();
          const id = crypto.randomUUID();
          ttsQueue.push(
            this.generateAudio(t, id).then(url => ({ url, text: t })),
          );
        }
      }
    }

    // Дрейним в порядке очереди — TTS уже в полёте, многие будут готовы сразу
    for (const p of ttsQueue) {
      const { url, text } = await p;
      if (url) yield { type: 'chunk', url, text };
    }

    if (intent === 'READY_TO_BUY') {
      await this.crm.updateStage(tenantId, contactId, 'NEGOTIATING');
    }

    yield { type: 'done', intent };
  }

  /** Разбивает буфер на завершённые предложения (заканчиваются [.!?] + пробел) */
  private flushSentences(buffer: string): { sentences: string[]; remaining: string } {
    // lookbehind: разбиваем после [.!?], если за ним пробел
    const parts = buffer.split(/(?<=[.!?])\s+/);
    if (parts.length <= 1) return { sentences: [], remaining: buffer };
    const sentences = parts.slice(0, -1).map((s) => s.trim()).filter(Boolean);
    return { sentences, remaining: parts[parts.length - 1] };
  }

  /**
   * Генерирует аудио — приоритет Yandex SpeechKit, fallback ElevenLabs
   */
  async generateAudio(text: string, id: string, permanent = false): Promise<string | undefined> {
    const yandexKey = this.config.get<string>('yandex.apiKey');
    if (yandexKey) {
      return this.generateAudioYandex(text, id, permanent);
    }
    return this.generateAudioElevenLabs(text, id, permanent);
  }

  /**
   * Yandex SpeechKit v1 TTS — lpcm 8000Hz → µ-law
   */
  private async generateAudioYandex(text: string, id: string, permanent = false): Promise<string | undefined> {
    const apiKey = this.config.get<string>('yandex.apiKey');
    const folderId = this.config.get<string>('yandex.folderId');
    const voice = this.config.get<string>('yandex.voice') ?? 'alena';
    const baseUrl = this.config.get<string>('app.baseUrl');

    const start = Date.now();
    try {
      const sampleRate = 8000;
      const params = new URLSearchParams({
        text,
        lang: 'ru-RU',
        voice,
        format: 'lpcm',
        sampleRateHertz: String(sampleRate),
        speed: '1.1',
        emotion: 'good',
        ...(folderId ? { folderId } : {}),
      });

      const res = await fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!res.ok) {
        this.logger.error(`Yandex TTS error: ${await res.text()}`);
        return undefined;
      }

      const pcm = Buffer.from(await res.arrayBuffer());
      const wav = this.pcmToWav(pcm, sampleRate);

      if (permanent) {
        this.staticBuffers.set(id, wav);
      } else {
        this.audioBuffers.set(id, wav);
        setTimeout(() => this.audioBuffers.delete(id), 120_000);
      }

      this.logger.log(`Yandex TTS: ${Date.now() - start}ms`);
      return `${baseUrl}/webhooks/voice/audio/${id}`;
    } catch (err) {
      this.logger.error('Yandex TTS generation failed', err);
      return undefined;
    }
  }

  /**
   * Оборачивает сырой PCM в WAV-контейнер (16-bit, mono)
   */
  private pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const header = Buffer.allocUnsafe(44);

    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);          // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(pcm.length, 40);

    return Buffer.concat([header, pcm]);
  }

  /**
   * Генерирует аудио через ElevenLabs
   */
  private async generateAudioElevenLabs(text: string, id: string, permanent = false): Promise<string | undefined> {
    const apiKey = this.config.get<string>('elevenlabs.apiKey');
    const voiceId = this.config.get<string>('elevenlabs.voiceIdRu');
    const baseUrl = this.config.get<string>('app.baseUrl');

    if (!apiKey || !voiceId) {
      this.logger.warn('ElevenLabs not configured, falling back to Voximplant TTS');
      return undefined;
    }

    const start = Date.now();
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          output_format: 'ulaw_8000',
          voice_settings: {
            stability: 0.25,
            similarity_boost: 0.6,
            style: 0.4,
            use_speaker_boost: true,
          },
        }),
      });

      if (!res.ok) {
        this.logger.error(`ElevenLabs error: ${await res.text()}`);
        return undefined;
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      if (permanent) {
        this.staticBuffers.set(id, buffer);
      } else {
        this.audioBuffers.set(id, buffer);
        setTimeout(() => this.audioBuffers.delete(id), 120_000);
      }

      this.logger.log(`ElevenLabs TTS: ${Date.now() - start}ms`);
      return `${baseUrl}/webhooks/voice/audio/${id}`;
    } catch (err) {
      this.logger.error('ElevenLabs generation failed', err);
      return undefined;
    }
  }

  /**
   * Отдаёт аудио-буфер по ID (из памяти)
   */
  getAudioBuffer(id: string): Buffer | null {
    return this.staticBuffers.get(id) ?? this.audioBuffers.get(id) ?? null;
  }

  /**
   * Инициировать исходящий звонок через Voximplant HTTP API
   */
  async initiateOutboundCall(toPhone: string): Promise<string> {
    const accountId = this.config.get<string>('voximplant.accountId');
    const apiKey = this.config.get<string>('voximplant.apiKey');
    const appName = this.config.get<string>('voximplant.appName');
    const fromPhone = this.config.get<string>('voximplant.phoneNumber');

    const params = new URLSearchParams({
      account_id: accountId ?? '',
      api_key: apiKey ?? '',
      phone: toPhone,
      caller_id: fromPhone ?? '',
      app_name: appName ?? 'ai-manager',
      script_name: 'main',
    });

    const res = await fetch(
      `https://api.voximplant.com/platform_api/StartScenarios/?${params}`,
    );

    const data = (await res.json()) as { result: number; call_session_id?: string };

    if (data.result !== 1) {
      throw new Error(`Voximplant call failed: ${JSON.stringify(data)}`);
    }

    this.logger.log(`Outbound call initiated: ${data.call_session_id} → ${toPhone}`);
    return data.call_session_id ?? '';
  }
}
