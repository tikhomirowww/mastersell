import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'changeme',
    });
  }

  validate(payload: JwtPayload) {
    if (!payload.sub) throw new UnauthorizedException();
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      isSuperAdmin: payload.isSuperAdmin,
    };
  }
}
