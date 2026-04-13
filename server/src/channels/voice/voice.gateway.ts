import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { VoiceService } from './voice.service';

interface VoxTranscriptMessage {
  type: 'transcript';
  callId: string;
  phone: string;
  text: string;
}

/**
 * WebSocket Gateway для Voximplant VoxEngine.
 * VoxEngine открывает соединение и шлёт транскрипт,
 * сервер отвечает чанками { type:'chunk', url, text } по мере генерации TTS.
 */
@WebSocketGateway({ path: '/voice/ws' })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VoiceGateway.name);

  constructor(private readonly voice: VoiceService) {}

  handleConnection(client: WebSocket) {
    this.logger.log('VoxEngine connected');

    client.on('message', async (raw: Buffer) => {
      let msg: VoxTranscriptMessage;
      try {
        msg = JSON.parse(raw.toString()) as VoxTranscriptMessage;
      } catch {
        this.logger.warn('Invalid JSON from VoxEngine');
        return;
      }

      if (msg.type !== 'transcript') return;

      const { callId, phone, text } = msg;
      this.logger.log(`[WS] callId=${callId} phone=${phone}: ${text}`);

      if (text?.trim() === '__greeting__') {
        const greetingUrl = this.voice.getGreetingUrl();
        if (greetingUrl) {
          this.send(client, { type: 'chunk', url: greetingUrl, text: 'Здравствуйте! Чем могу помочь?' });
        }
        this.send(client, { type: 'done', intent: 'OTHER' });
        // Сохраняем приветствие в историю сессии — агент не будет здороваться повторно
        this.voice.seedGreeting(callId, phone).catch((e) => this.logger.warn('seedGreeting failed', e));
        return;
      }

      if (!text?.trim()) {
        // Пустой транскрипт — ничего не генерируем
        this.send(client, { type: 'done', intent: 'OTHER' });
        return;
      }

      try {
        for await (const event of this.voice.handleTranscriptStream(callId, phone, text)) {
          if (client.readyState !== WebSocket.OPEN) break;
          this.send(client, event);
        }
      } catch (err) {
        this.logger.error('Stream error', err);
        this.send(client, { type: 'error', message: 'Internal error' });
      }
    });
  }

  handleDisconnect() {
    this.logger.log('VoxEngine disconnected');
  }

  private send(client: WebSocket, data: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}
