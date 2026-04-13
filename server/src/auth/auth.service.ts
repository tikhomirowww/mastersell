import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import type { TeamService } from '../team/team.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CrmService } from '../crm/crm.service';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface JwtPayload {
  sub: string;       // userId
  tenantId: string | null;
  isSuperAdmin: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly crm: CrmService,
    private readonly jwt: JwtService,
  ) {}

  async findOrCreateUser(profile: GoogleProfile) {
    // Ищем по googleId
    let user = await this.crm.user.findUnique({ where: { googleId: profile.googleId } });

    if (!user) {
      // Ищем по email (вдруг уже есть без googleId)
      user = await this.crm.user.findUnique({ where: { email: profile.email } });
      if (user) {
        user = await this.crm.user.update({
          where: { id: user.id },
          data: { googleId: profile.googleId, avatarUrl: profile.avatarUrl },
        });
      } else {
        // Первый суперадмин — если никого нет
        const count = await this.crm.user.count();
        const isSuperAdmin = count === 0;

        // Новый пользователь → создаём тенант для него автоматически
        const tenant = await this.crm.tenant.create({
          data: { name: profile.name ?? profile.email },
        });

        user = await this.crm.user.create({
          data: {
            googleId: profile.googleId,
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            isSuperAdmin,
            tenantId: tenant.id,
            role: 'ADMIN',
          },
        });
      }
    }

    return user;
  }

  async register(email: string, password: string) {
    const existing = await this.crm.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email уже зарегистрирован');

    const passwordHash = await bcrypt.hash(password, 10);
    const count = await this.crm.user.count();
    const name = email.split('@')[0];

    const tenant = await this.crm.tenant.create({ data: { name } });

    const user = await this.crm.user.create({
      data: {
        email,
        name,
        passwordHash,
        tenantId: tenant.id,
        isSuperAdmin: count === 0,
        role: 'ADMIN', // создатель тенанта всегда ADMIN
      },
    });

    return { token: this.issueToken(user) };
  }

  async loginWithPassword(email: string, password: string) {
    const user = await this.crm.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Неверный email или пароль');

    return { token: this.issueToken(user) };
  }

  async getMe(userId: string) {
    const user = await this.crm.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, avatarUrl: true,
        isSuperAdmin: true, tenantId: true, role: true,
        tenant: { select: { name: true, logoUrl: true } },
      },
    });
    if (!user) throw new UnauthorizedException();
    return { ...user, tenantName: user.tenant?.name ?? null, tenantLogoUrl: user.tenant?.logoUrl ?? null };
  }

  async updateMe(userId: string, data: { name?: string; tenantName?: string; avatarUrl?: string }) {
    const { tenantName, ...userData } = data;

    if (tenantName) {
      const user = await this.crm.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
      if (user?.tenantId) {
        await this.crm.tenant.update({ where: { id: user.tenantId }, data: { name: tenantName } });
      }
    }

    if (Object.keys(userData).length > 0) {
      await this.crm.user.update({ where: { id: userId }, data: userData });
    }

    return this.getMe(userId);
  }

  /** Регистрация через инвайт — создаём пользователя в тенанте приглашающего */
  async registerViaInvite(token: string, email: string, password: string, teamSvc: TeamService) {
    const invite = await teamSvc.getInviteByToken(token);

    const existing = await this.crm.user.findUnique({ where: { email } });
    if (existing) {
      // Пользователь уже есть — просто присоединяем к тенанту
      const newTenantId = await teamSvc.acceptInvite(token, existing.id);
      const updatedUser = { ...existing, tenantId: newTenantId };
      return { token: this.issueToken(updatedUser) };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const name = email.split('@')[0];

    const user = await this.crm.user.create({
      data: {
        email,
        name,
        passwordHash,
        tenantId: invite.tenantId,
        isSuperAdmin: false,
      },
    });

    await this.crm.invite.update({ where: { token }, data: { usedAt: new Date() } });
    return { token: this.issueToken(user) };
  }

  /** Вход через инвайт — логиним и переключаем тенант */
  async loginViaInvite(token: string, email: string, password: string, teamSvc: TeamService) {
    const user = await this.crm.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Неверный email или пароль');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Неверный email или пароль');

    const newTenantId = await teamSvc.acceptInvite(token, user.id);
    return { token: this.issueToken({ ...user, tenantId: newTenantId }) };
  }

  issueToken(user: { id: string; tenantId: string | null; isSuperAdmin: boolean }): string {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      isSuperAdmin: user.isSuperAdmin,
    };
    return this.jwt.sign(payload);
  }
}
