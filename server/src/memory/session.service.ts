import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ClaudeMessage } from '../lib/claude/claude.service';

// Храним максимум 10 последних сообщений в "горячей" памяти
// Остальное — в сжатом summary (поле conversation.summary в PG)
const MAX_HOT_MESSAGES = 10;
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 часа

export interface SessionData {
  contactId: string;
  channel: string;
  language: 'RU' | 'KY';
  messages: ClaudeMessage[];
  summary?: string; // сжатая история старых сообщений
}

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private redis: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.redis = new Redis({
      host: this.config.get<string>('redis.host'),
      port: this.config.get<number>('redis.port'),
    });
    this.redis.on('error', (err) => this.logger.error('Redis error', err));
    this.logger.log('Redis connected');
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private key(sessionId: string) {
    return `session:${sessionId}`;
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const raw = await this.redis.get(this.key(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  }

  async set(sessionId: string, data: SessionData): Promise<void> {
    await this.redis.setex(
      this.key(sessionId),
      SESSION_TTL_SECONDS,
      JSON.stringify(data),
    );
  }

  async appendMessage(
    sessionId: string,
    message: ClaudeMessage,
    defaults: Omit<SessionData, 'messages'>,
  ): Promise<SessionData> {
    const session = (await this.get(sessionId)) ?? {
      ...defaults,
      messages: [],
    };

    session.messages.push(message);

    // Если сообщений накопилось много — сигнализируем наружу,
    // что пора делать summary (вызывается из SalesService)
    if (session.messages.length > MAX_HOT_MESSAGES) {
      session.messages = session.messages.slice(-MAX_HOT_MESSAGES);
    }

    await this.set(sessionId, session);
    return session;
  }

  async updateSummary(sessionId: string, summary: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    session.summary = summary;
    await this.set(sessionId, session);
  }

  async needsSummarization(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    return (session?.messages.length ?? 0) >= MAX_HOT_MESSAGES;
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }
}
