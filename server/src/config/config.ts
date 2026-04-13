import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  baseUrl: process.env.BASE_URL ?? 'http://localhost:3001',
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
}));

export const anthropicConfig = registerAs('anthropic', () => ({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  // Дешёвая модель для классификации намерений
  classifierModel: 'claude-haiku-4-5-20251001',
  // На старте используем Haiku — быстрее и дешевле, на Sonnet переключишь когда будет трафик
  salesModel: 'claude-haiku-4-5-20251001',
}));

export const twilioConfig = registerAs('twilio', () => ({
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? '',
  phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? '',
}));

export const metaConfig = registerAs('meta', () => ({
  appId: process.env.META_APP_ID ?? '',
  appSecret: process.env.META_APP_SECRET ?? '',
  verifyToken: process.env.META_VERIFY_TOKEN ?? '',
  pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN ?? '',
  instagramAccessToken: process.env.META_INSTAGRAM_ACCESS_TOKEN ?? '',
  whatsappPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? '',
  whatsappBusinessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
}));

export const voximplantConfig = registerAs('voximplant', () => ({
  accountId: process.env.VOXIMPLANT_ACCOUNT_ID ?? '',
  apiKey: process.env.VOXIMPLANT_API_KEY ?? '',
  appName: process.env.VOXIMPLANT_APP_NAME ?? 'ai-manager',
  phoneNumber: process.env.VOXIMPLANT_PHONE_NUMBER ?? '',
}));

export const deepgramConfig = registerAs('deepgram', () => ({
  apiKey: process.env.DEEPGRAM_API_KEY ?? '',
}));

export const elevenlabsConfig = registerAs('elevenlabs', () => ({
  apiKey: process.env.ELEVENLABS_API_KEY ?? '',
  voiceIdRu: process.env.ELEVENLABS_VOICE_ID_RU ?? '',
  voiceIdKy: process.env.ELEVENLABS_VOICE_ID_KY ?? '',
}));

export const greenApiConfig = registerAs('greenApi', () => ({
  partnerToken: process.env.GREENAPI_PARTNER_TOKEN ?? '',
}));

export const yandexConfig = registerAs('yandex', () => ({
  // Приоритет над ElevenLabs — если задан, используем Yandex
  apiKey: process.env.YANDEX_TTS_API_KEY ?? '',
  folderId: process.env.YANDEX_FOLDER_ID ?? '',
  // alena (женский) / filipp (мужской) / zahar / ermil
  voice: process.env.YANDEX_TTS_VOICE ?? 'alena',
}));
