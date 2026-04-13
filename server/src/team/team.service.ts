import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CrmService } from '../crm/crm.service';

@Injectable()
export class TeamService {
  constructor(private readonly crm: CrmService) {}

  /** Список участников тенанта */
  getMembers(tenantId: string) {
    return this.crm.user.findMany({
      where: { tenantId },
      select: { id: true, name: true, email: true, avatarUrl: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Проверить, является ли пользователь ADMIN в тенанте */
  async assertAdmin(tenantId: string, userId: string) {
    const user = await this.crm.user.findFirst({ where: { id: userId, tenantId } });
    if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Нужны права администратора');
  }

  /** Удалить участника (только ADMIN, нельзя удалить себя) */
  async removeMember(tenantId: string, requesterId: string, userId: string) {
    await this.assertAdmin(tenantId, requesterId);
    if (requesterId === userId) throw new ForbiddenException('Нельзя удалить себя');
    const user = await this.crm.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return this.crm.user.update({ where: { id: userId }, data: { tenantId: null, role: 'MEMBER' } });
  }

  /** Изменить роль участника (только ADMIN) */
  async changeRole(tenantId: string, requesterId: string, userId: string, role: 'ADMIN' | 'MEMBER') {
    await this.assertAdmin(tenantId, requesterId);
    if (requesterId === userId) throw new ForbiddenException('Нельзя изменить собственную роль');
    const user = await this.crm.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return this.crm.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, name: true, email: true, avatarUrl: true, role: true, createdAt: true },
    });
  }

  /** Создать инвайт (только ADMIN) */
  async createInvite(tenantId: string, createdBy: string) {
    await this.assertAdmin(tenantId, createdBy);
    return this.crm.invite.create({ data: { tenantId, createdBy } });
  }

  /** Список неиспользованных инвайтов тенанта */
  getInvites(tenantId: string) {
    return this.crm.invite.findMany({
      where: { tenantId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Отозвать инвайт (только ADMIN) */
  async revokeInvite(tenantId: string, requesterId: string, id: string) {
    await this.assertAdmin(tenantId, requesterId);
    const count = await this.crm.invite.deleteMany({ where: { id, tenantId } });
    if (count.count === 0) throw new NotFoundException('Инвайт не найден');
  }

  /** Получить инвайт по токену (публично) */
  async getInviteByToken(token: string) {
    const invite = await this.crm.invite.findUnique({
      where: { token },
      include: { tenant: { select: { name: true } } },
    });
    if (!invite || invite.usedAt) {
      throw new NotFoundException('Приглашение не найдено или уже использовано');
    }
    return invite;
  }

  /** Принять инвайт */
  async acceptInvite(token: string, userId: string): Promise<string> {
    const invite = await this.getInviteByToken(token);
    await this.crm.user.update({
      where: { id: userId },
      data: { tenantId: invite.tenantId, role: 'MEMBER' },
    });
    await this.crm.invite.update({ where: { token }, data: { usedAt: new Date() } });
    return invite.tenantId;
  }
}
