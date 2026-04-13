import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import { FastifyRequest } from 'fastify';

/**
 * Guard для проверки подписи Twilio на входящих webhook запросах.
 * Без этого любой может имитировать сообщения от Twilio.
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TwilioSignatureGuard.name);
  private readonly authToken: string;

  constructor(private readonly config: ConfigService) {
    this.authToken = this.config.get<string>('twilio.authToken') ?? '';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const signature = request.headers['x-twilio-signature'] as string;
    const url = `https://${request.headers.host}${request.url}`;
    const params = request.body as Record<string, string>;

    const isValid = Twilio.validateRequest(
      this.authToken,
      signature,
      url,
      params,
    );

    if (!isValid) {
      this.logger.warn(`Invalid Twilio signature from ${request.ip}`);
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    return true;
  }
}
