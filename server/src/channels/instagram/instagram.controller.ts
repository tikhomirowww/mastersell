import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../auth/decorators';
import { InstagramService } from './instagram.service';
import { InstagramWebhookDto } from './dto/instagram-webhook.dto';

@Public()
@Controller('webhooks/instagram')
export class InstagramController {
  private readonly logger = new Logger(InstagramController.name);

  constructor(
    private readonly instagram: InstagramService,
    private readonly config: ConfigService,
  ) {}

  // Meta верифицирует webhook через GET-запрос
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expected = this.config.get<string>('meta.verifyToken');
    if (mode === 'subscribe' && token === expected) {
      this.logger.log('Meta webhook verified');
      return challenge;
    }
    throw new ForbiddenException('Invalid verify token');
  }

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() payload: InstagramWebhookDto): Promise<string> {
    if (payload.object !== 'instagram') return 'ok';

    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        this.instagram.handleMessage(event).catch((err) =>
          this.logger.error('Error handling Instagram message', err),
        );
      }
    }

    return 'ok';
  }
}
