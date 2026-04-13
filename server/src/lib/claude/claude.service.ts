import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic;
  private readonly salesModel: string;
  private readonly classifierModel: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('anthropic.apiKey'),
    });
    this.salesModel = this.config.get<string>('anthropic.salesModel') ?? 'claude-sonnet-4-6';
    this.classifierModel =
      this.config.get<string>('anthropic.classifierModel') ?? 'claude-haiku-4-5-20251001';
  }

  /**
   * Retry при 529 (overloaded) — до 3 попыток с экспоненциальной задержкой
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        const isOverloaded = err?.status === 529 || err?.message?.includes('overloaded');
        if (isOverloaded && i < retries - 1) {
          const delay = 2000 * (i + 1); // 2s, 4s, 6s
          this.logger.warn(`Claude overloaded, retry ${i + 1}/${retries} in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Основной диалог — используем Sonnet (продажи, сложные ответы)
   */
  async chat(
    systemPrompt: string,
    messages: ClaudeMessage[],
    maxTokens = 512,
  ): Promise<ClaudeResponse> {
    const response = await this.withRetry(() =>
      this.client.messages.create({
        model: this.salesModel,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    );

    const content =
      response.content[0].type === 'text' ? response.content[0].text : '';

    this.logger.debug(
      `[Sales] in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
    );

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  /**
   * Стриминг ответа — для голосового агента, первый чанк приходит быстрее
   */
  async *chatStream(
    systemPrompt: string,
    messages: ClaudeMessage[],
    maxTokens = 160,
  ): AsyncGenerator<string> {
    const stream = this.client.messages.stream({
      model: this.salesModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }

  /**
   * Быстрая классификация — используем Haiku (дёшево и быстро)
   */
  async classify(prompt: string, userMessage: string): Promise<string> {
    const response = await this.withRetry(() =>
      this.client.messages.create({
        model: this.classifierModel,
        max_tokens: 64,
        messages: [{ role: 'user', content: `${prompt}\n\nСообщение: "${userMessage}"` }],
      }),
    );

    const result =
      response.content[0].type === 'text' ? response.content[0].text.trim() : 'UNKNOWN';

    this.logger.debug(
      `[Classifier] result=${result} tokens=${response.usage.input_tokens + response.usage.output_tokens}`,
    );

    return result;
  }

  /**
   * Сжатие истории диалога для экономии токенов
   */
  async summarizeHistory(messages: ClaudeMessage[]): Promise<string> {
    const formatted = messages
      .map((m) => `${m.role === 'user' ? 'Клиент' : 'Менеджер'}: ${m.content}`)
      .join('\n');

    const response = await this.withRetry(() =>
      this.client.messages.create({
        model: this.classifierModel,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: `Сожми этот диалог в краткое резюме (3-5 предложений), сохранив ключевые факты о клиенте, его интересах и договорённостях:\n\n${formatted}`,
          },
        ],
      }),
    );

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }
}
