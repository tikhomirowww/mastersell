import { Injectable, Logger } from '@nestjs/common';
import { Language } from '@prisma/client';
import { ClaudeService } from '../../lib/claude/claude.service';
import { SessionService } from '../../memory/session.service';
import { ClassifierService, Intent } from '../classifier/classifier.service';
import { CrmService } from '../../crm/crm.service';
import { buildSalesPrompt } from './sales.prompt';

export interface IncomingMessage {
  sessionId: string;
  contactId: string;
  tenantId: string;
  channel: 'WHATSAPP' | 'INSTAGRAM' | 'VOICE';
  language: Language;
  text: string;
}

export interface AgentReply {
  text: string;
  intent: Intent;
  shouldEscalate: boolean; // передать живому оператору
  tokensUsed: number;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  // Кэш профиля — не дёргаем БД на каждое сообщение
  private profileCache: { name: string; agentContext: string } | null = null;
  private profileCacheKey = '';
  private profileCachedAt = 0;
  private readonly PROFILE_TTL_MS = 15 * 1000; // 15 секунд — обновляется почти сразу после изменения

  constructor(
    private readonly claude: ClaudeService,
    private readonly session: SessionService,
    private readonly classifier: ClassifierService,
    private readonly crm: CrmService,
  ) {}

  private async getProfile(tenantId: string): Promise<{ name: string; agentContext: string }> {
    const cacheKey = tenantId;
    if (this.profileCache && this.profileCacheKey === cacheKey && Date.now() - this.profileCachedAt < this.PROFILE_TTL_MS) {
      return this.profileCache;
    }
    const profile = await this.crm.getBusinessProfile(tenantId);
    this.profileCache = { name: profile.name, agentContext: profile.agentContext };
    this.profileCacheKey = cacheKey;
    this.profileCachedAt = Date.now();
    return this.profileCache;
  }

  async handle(incoming: IncomingMessage): Promise<AgentReply> {
    if (incoming.channel === 'VOICE') {
      return this.handleVoice(incoming);
    }
    return this.handleText(incoming);
  }

  /**
   * Голосовой канал — один вызов Claude вместо двух (нет отдельного классификатора).
   * Намерение встраивается в ответ через префикс [INTENT:XXX].
   */
  private async handleVoice(incoming: IncomingMessage): Promise<AgentReply> {
    const [profile, currentSession] = await Promise.all([
      this.getProfile(incoming.tenantId),
      this.session.appendMessage(
        incoming.sessionId,
        { role: 'user', content: incoming.text },
        {
          contactId: incoming.contactId,
          channel: incoming.channel,
          language: incoming.language,
        },
      ),
    ]);

    if (await this.session.needsSummarization(incoming.sessionId)) {
      const summary = await this.claude.summarizeHistory(currentSession.messages);
      await this.session.updateSummary(incoming.sessionId, summary);
    }

    const systemPrompt = buildSalesPrompt(incoming.language, currentSession.summary, 'VOICE', profile);
    const { content, inputTokens, outputTokens } = await this.claude.chat(
      systemPrompt,
      currentSession.messages,
      160,
    );

    // Парсим намерение из префикса [INTENT:XXX] и убираем его из текста
    const intentMatch = content.match(/^\[INTENT:([\w_]+)\]\s*/);
    const intent: Intent = (intentMatch?.[1] as Intent) ?? 'OTHER';
    const text = intentMatch ? content.slice(intentMatch[0].length) : content;

    this.logger.log(`[VOICE] intent=${intent} session=${incoming.sessionId}`);

    await this.session.appendMessage(
      incoming.sessionId,
      { role: 'assistant', content: text },
      {
        contactId: incoming.contactId,
        channel: incoming.channel,
        language: incoming.language,
      },
    );

    return {
      text,
      intent,
      shouldEscalate: intent === 'HUMAN_NEEDED',
      tokensUsed: inputTokens + outputTokens,
    };
  }

  /**
   * Голосовой канал со стримингом — отдаёт чанки текста по мере генерации Claude.
   * Колбэк вызывается после стрима для сохранения сессии.
   * Тип события: { kind:'text', chunk } или { kind:'done', intent }
   */
  async *streamVoiceRaw(
    incoming: IncomingMessage,
  ): AsyncGenerator<{ kind: 'text'; chunk: string } | { kind: 'done'; intent: Intent }> {
    const [profile, currentSession] = await Promise.all([
      this.getProfile(incoming.tenantId),
      this.session.appendMessage(
        incoming.sessionId,
        { role: 'user', content: incoming.text },
        {
          contactId: incoming.contactId,
          channel: incoming.channel,
          language: incoming.language,
        },
      ),
    ]);

    // Для голосового канала не делаем summarization в критическом пути —
    // каждый звонок имеет свой sessionId, история короткая.
    // Вместо этого обрезаем историю до последних 6 сообщений (3 хода).
    const MAX_VOICE_MESSAGES = 6;
    const voiceMessages = currentSession.messages.slice(-MAX_VOICE_MESSAGES);

    const systemPrompt = buildSalesPrompt(
      incoming.language,
      currentSession.summary,
      'VOICE',
      profile,
    );

    let intentParsed = false;
    let intent: Intent = 'OTHER';
    let prefixBuffer = '';
    let fullText = '';

    for await (const chunk of this.claude.chatStream(systemPrompt, voiceMessages, 160)) {
      fullText += chunk;

      if (!intentParsed) {
        prefixBuffer += chunk;
        const match = prefixBuffer.match(/^\[INTENT:([\w_]+)\]\s*/);
        if (match) {
          intent = match[1] as Intent;
          const rest = prefixBuffer.slice(match[0].length);
          intentParsed = true;
          if (rest) yield { kind: 'text', chunk: rest };
        } else if (prefixBuffer.length > 50 || (!prefixBuffer.startsWith('[') && prefixBuffer.length > 5)) {
          // No intent tag — stream as-is
          intentParsed = true;
          if (prefixBuffer) yield { kind: 'text', chunk: prefixBuffer };
        }
      } else {
        yield { kind: 'text', chunk };
      }
    }

    yield { kind: 'done', intent };

    // Сохраняем ответ ассистента в сессию
    const cleanText = fullText.replace(/^\[INTENT:[\w_]+\]\s*/, '');
    await this.session.appendMessage(
      incoming.sessionId,
      { role: 'assistant', content: cleanText },
      {
        contactId: incoming.contactId,
        channel: incoming.channel,
        language: incoming.language,
      },
    );

    this.logger.log(`[VOICE-STREAM] intent=${intent} session=${incoming.sessionId}`);
  }

  /**
   * Текстовые каналы (WhatsApp, Instagram) — классификатор + генерация параллельно.
   */
  private async handleText(incoming: IncomingMessage): Promise<AgentReply> {
    const maxTokens = 512;

    const [intent, currentSession, profile] = await Promise.all([
      this.classifier.classify(incoming.text),
      this.session.appendMessage(
        incoming.sessionId,
        { role: 'user', content: incoming.text },
        {
          contactId: incoming.contactId,
          channel: incoming.channel,
          language: incoming.language,
        },
      ),
      this.getProfile(incoming.tenantId),
    ]);

    this.logger.log(`[${incoming.channel}] intent=${intent} session=${incoming.sessionId}`);

    if (intent === 'HUMAN_NEEDED') {
      return {
        text: this.humanHandoffMessage(incoming.language),
        intent,
        shouldEscalate: true,
        tokensUsed: 0,
      };
    }

    if (await this.session.needsSummarization(incoming.sessionId)) {
      const summary = await this.claude.summarizeHistory(currentSession.messages);
      await this.session.updateSummary(incoming.sessionId, summary);
      this.logger.debug(`[Summary] session=${incoming.sessionId} compressed`);
    }

    const systemPrompt = buildSalesPrompt(incoming.language, currentSession.summary, incoming.channel, profile);
    const { content, inputTokens, outputTokens } = await this.claude.chat(
      systemPrompt,
      currentSession.messages,
      maxTokens,
    );

    await this.session.appendMessage(
      incoming.sessionId,
      { role: 'assistant', content },
      {
        contactId: incoming.contactId,
        channel: incoming.channel,
        language: incoming.language,
      },
    );

    return {
      text: content,
      intent,
      shouldEscalate: false,
      tokensUsed: inputTokens + outputTokens,
    };
  }

  private humanHandoffMessage(language: Language): string {
    if (language === 'KY') {
      return 'Жакшы, мен сизди оператор менен байланыштырам. Бир аз күтө туруңуз.';
    }
    return 'Хорошо, сейчас соединю вас с оператором. Одну минуту.';
  }
}
