import { Public } from '../../auth/decorators';
import { Controller, Post, Get, Body, Query, Param, HttpCode, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { VoiceService } from './voice.service';

interface VoximplantRelayDto {
  callId: string;
  phone: string;
  text: string;
}

@Public()
@Controller('webhooks/voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(private readonly voice: VoiceService) {}

  /**
   * Voximplant сценарий отправляет сюда транскрипт речи
   * Принимает параметры из query string (VoxEngine не парсит JSON body)
   */
  @Post('relay')
  @HttpCode(200)
  async handleRelay(
    @Query('callId') callId: string,
    @Query('phone') phone: string,
    @Query('text') text: string,
    @Body() body: VoximplantRelayDto,
  ): Promise<{ text: string; audioUrl?: string }> {
    // Query params имеют приоритет, body — fallback
    const effectiveCallId = callId || body?.callId;
    const effectivePhone = phone || body?.phone;
    const effectiveText = text || body?.text;

    this.logger.log(`[Voice] callId=${effectiveCallId} phone=${effectivePhone}: ${effectiveText}`);

    const result = await this.voice.handleTranscript(
      effectiveCallId,
      effectivePhone,
      effectiveText,
    );

    return result;
  }

  /**
   * Отдаёт аудио-буфер для Voximplant call.playURL()
   */
  @Get('audio/:id')
  serveAudio(@Param('id') id: string, @Res() res: Response): void {
    const buffer = this.voice.getAudioBuffer(id);
    if (!buffer) {
      res.status(404).send('Not found');
      return;
    }
    const isWav = buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'RIFF';
    res.setHeader('Content-Type', isWav ? 'audio/wav' : 'audio/basic');
    res.send(buffer);
  }

  /**
   * Возвращает URL'ы прегенерированных филлеров для VoxEngine
   */
  @Get('fillers')
  getFillers(): { urls: string[] } {
    return { urls: this.voice.getFillerUrls() };
  }

  /**
   * Инициировать исходящий звонок через Voximplant
   */
  @Post('outbound')
  @HttpCode(200)
  async initiateCall(@Body() body: { phone: string }): Promise<{ callId: string }> {
    const callId = await this.voice.initiateOutboundCall(body.phone);
    return { callId };
  }
}
