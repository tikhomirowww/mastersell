import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import {
  appConfig,
  redisConfig,
  anthropicConfig,
  twilioConfig,
  metaConfig,
  voximplantConfig,
  deepgramConfig,
  elevenlabsConfig,
  yandexConfig,
  greenApiConfig,
} from './config/config';

// Auth
import { AuthModule } from './auth/auth.module';
import { TeamModule } from './team/team.module';
import { JwtAuthGuard } from './auth/jwt.guard';

// Lib
import { ClaudeModule } from './lib/claude/claude.module';

// Core
import { MemoryModule } from './memory/memory.module';
import { CrmModule } from './crm/crm.module';
import { AgentsModule } from './agents/agents.module';

// Channels
import { WhatsAppModule } from './channels/whatsapp/whatsapp.module';
import { InstagramModule } from './channels/instagram/instagram.module';
import { VoiceModule } from './channels/voice/voice.module';

@Module({
  providers: [
    // JWT guard применяется глобально; webhook-роуты помечены @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  imports: [
    // Конфигурация из .env
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        redisConfig,
        anthropicConfig,
        twilioConfig,
        metaConfig,
        voximplantConfig,
        deepgramConfig,
        elevenlabsConfig,
        yandexConfig,
        greenApiConfig,
      ],
    }),

    // ── Auth ────────────────────────────────────────────
    AuthModule,
    TeamModule,

    // ── Глобальные сервисы ───────────────────────────────
    ClaudeModule,
    MemoryModule,
    CrmModule,

    // ── Агенты ──────────────────────────────────────────
    AgentsModule,

    // ── Каналы ──────────────────────────────────────────
    WhatsAppModule,
    InstagramModule,
    VoiceModule,
  ],
})
export class AppModule {}
