import { SetMetadata, createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './jwt.guard';

/** Пометить роут как публичный (без JWT) */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Получить tenantId из JWT в контроллере */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('User has no workspace');
    return tenantId;
  },
);

/** Получить userId из JWT */
export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.userId;
  },
);
