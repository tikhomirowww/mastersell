import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, Contact, Channel, CrmStage, ActivityType } from '@prisma/client';
import {
  CreateContactDto,
  UpdateContactDto,
  ContactsQueryDto,
  CreateNoteDto,
  CreateTagDto,
} from './dto/contact.dto';

@Injectable()
export class CrmService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(CrmService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  // ─── Tenant lookup (для webhook роутинга) ──────────────────────────────────

  async getTenantIdByPhone(phoneNumber: string): Promise<string | null> {
    const num = await this.phoneNumber.findUnique({
      where: { number: phoneNumber },
      select: { tenantId: true },
    });
    return num?.tenantId ?? null;
  }

  async getTenantByGreenApiInstance(instanceId: string): Promise<{ tenantId: string; token: string } | null> {
    const profile = await this.businessProfile.findFirst({
      where: { greenApiInstanceId: instanceId },
      select: { tenantId: true, greenApiToken: true },
    });
    if (!profile?.greenApiToken) return null;
    return { tenantId: profile.tenantId, token: profile.greenApiToken };
  }

  async getTenantByInstagramAccount(accountId: string): Promise<{ tenantId: string; token: string } | null> {
    const profile = await this.businessProfile.findUnique({
      where: { instagramAccountId: accountId },
      select: { tenantId: true, instagramAccessToken: true },
    });
    if (!profile?.instagramAccessToken) return null;
    return { tenantId: profile.tenantId, token: profile.instagramAccessToken };
  }

  // ─── Contacts ──────────────────────────────────────────────────────────────

  async getContacts(tenantId: string, query: ContactsQueryDto) {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.stage) where.stage = query.stage;
    if (query.language) where.language = query.language;

    const [contacts, total] = await Promise.all([
      this.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          tags: { include: { tag: true } },
          _count: { select: { conversations: true, calls: true } },
        },
      }),
      this.contact.count({ where }),
    ]);

    return {
      data: contacts,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getContact(tenantId: string, id: string) {
    const contact = await this.contact.findFirst({
      where: { id, tenantId },
      include: {
        tags: { include: { tag: true } },
        contactNotes: { orderBy: { createdAt: 'desc' } },
        conversations: {
          orderBy: { updatedAt: 'desc' },
          take: 5,
          include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
        calls: { orderBy: { createdAt: 'desc' }, take: 5 },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async createContact(tenantId: string, dto: CreateContactDto): Promise<Contact> {
    const contact = await this.contact.create({ data: { ...dto, tenantId } });
    await this.logActivity(contact.id, 'CONTACT_CREATED', 'Контакт создан');
    return contact;
  }

  async updateContact(tenantId: string, id: string, dto: UpdateContactDto): Promise<Contact> {
    await this.findOrThrow(tenantId, id);
    return this.contact.update({ where: { id }, data: dto });
  }

  async deleteContact(tenantId: string, id: string): Promise<void> {
    await this.findOrThrow(tenantId, id);
    await this.contact.delete({ where: { id } });
  }

  async updateStage(tenantId: string, contactId: string, stage: CrmStage): Promise<Contact> {
    const contact = await this.findOrThrow(tenantId, contactId);
    const updated = await this.contact.update({ where: { id: contactId }, data: { stage } });

    await this.logActivity(
      contactId,
      'STAGE_CHANGED',
      `Стадия изменена: ${contact.stage} → ${stage}`,
      { from: contact.stage, to: stage },
    );

    return updated;
  }

  async upsertContact(
    tenantId: string,
    data: { phone?: string; instagramId?: string; name?: string },
  ): Promise<Contact> {
    const where = data.phone
      ? { tenantId_phone: { tenantId, phone: data.phone } }
      : { tenantId_instagramId: { tenantId, instagramId: data.instagramId! } };

    const existing = await this.contact.findUnique({ where: where as any });
    if (existing) return this.fillMissingName(existing, data.name);

    try {
      const created = await this.contact.create({ data: { ...data, tenantId } });
      await this.logActivity(created.id, 'CONTACT_CREATED', 'Контакт создан автоматически');
      return created;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
      const winner = await this.contact.findUniqueOrThrow({ where: where as any });
      return this.fillMissingName(winner, data.name);
    }
  }

  private fillMissingName(contact: Contact, name?: string): Promise<Contact> | Contact {
    if (name && !contact.name) {
      return this.contact.update({ where: { id: contact.id }, data: { name } });
    }
    return contact;
  }

  // ─── Notes ─────────────────────────────────────────────────────────────────

  async getNotes(tenantId: string, contactId: string) {
    await this.findOrThrow(tenantId, contactId);
    return this.contactNote.findMany({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createNote(tenantId: string, contactId: string, dto: CreateNoteDto) {
    await this.findOrThrow(tenantId, contactId);
    const note = await this.contactNote.create({ data: { contactId, text: dto.text } });
    await this.logActivity(contactId, 'NOTE_ADDED', 'Заметка добавлена');
    return note;
  }

  async deleteNote(tenantId: string, contactId: string, noteId: string): Promise<void> {
    await this.findOrThrow(tenantId, contactId);
    const { count } = await this.contactNote.deleteMany({ where: { id: noteId, contactId } });
    if (count === 0) throw new NotFoundException('Note not found');
  }

  // ─── Tags ──────────────────────────────────────────────────────────────────

  async getAllTags(tenantId: string) {
    return this.tag.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async createTag(tenantId: string, dto: CreateTagDto) {
    return this.tag.upsert({
      where: { tenantId_name: { tenantId, name: dto.name } },
      update: {},
      create: { tenantId, name: dto.name, color: dto.color ?? '#6366f1' },
    });
  }

  async addTagToContact(tenantId: string, contactId: string, tagId: string) {
    await this.findOrThrow(tenantId, contactId);
    const tag = await this.tag.findFirst({ where: { id: tagId, tenantId } });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId } },
      update: {},
      create: { contactId, tagId },
    });
    await this.logActivity(contactId, 'TAG_ADDED', `Тег добавлен: ${tag.name}`);
  }

  async removeTagFromContact(tenantId: string, contactId: string, tagId: string) {
    await this.findOrThrow(tenantId, contactId);
    await this.contactTag.delete({ where: { contactId_tagId: { contactId, tagId } } });
    const tag = await this.tag.findUnique({ where: { id: tagId } });
    await this.logActivity(contactId, 'TAG_REMOVED', `Тег удалён: ${tag?.name}`);
  }

  // ─── Pipeline ──────────────────────────────────────────────────────────────

  async getPipeline(tenantId: string) {
    const stages: CrmStage[] = ['NEW', 'CONTACTED', 'INTERESTED', 'NEGOTIATING', 'WON', 'LOST'];

    const contacts = await this.contact.findMany({
      where: { tenantId },
      include: { tags: { include: { tag: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    return stages.map((stage) => ({
      stage,
      contacts: contacts.filter((c) => c.stage === stage),
      count: contacts.filter((c) => c.stage === stage).length,
    }));
  }

  // ─── Analytics ─────────────────────────────────────────────────────────────

  async getAnalytics(tenantId: string) {
    const [
      totalContacts,
      byStage,
      byChannel,
      recentActivity,
      wonThisMonth,
      totalMessages,
    ] = await Promise.all([
      this.contact.count({ where: { tenantId } }),
      this.contact.groupBy({ by: ['stage'], where: { tenantId }, _count: true }),
      this.conversation.groupBy({
        by: ['channel'],
        where: { contact: { tenantId } },
        _count: true,
      }),
      this.activityLog.findMany({
        where: { contact: { tenantId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { contact: { select: { name: true, phone: true } } },
      }),
      this.contact.count({
        where: {
          tenantId,
          stage: 'WON',
          updatedAt: { gte: new Date(new Date().setDate(1)) },
        },
      }),
      this.message.count({
        where: { conversation: { contact: { tenantId } } },
      }),
    ]);

    const wonCount = byStage.find((s) => s.stage === 'WON')?._count ?? 0;
    const conversionRate = totalContacts > 0 ? Math.round((wonCount / totalContacts) * 100) : 0;

    return {
      totalContacts,
      conversionRate,
      wonThisMonth,
      totalMessages,
      byStage: byStage.map((s) => ({ stage: s.stage, count: s._count })),
      byChannel: byChannel.map((c) => ({ channel: c.channel, count: c._count })),
      recentActivity,
    };
  }

  // ─── Messages (для AI агентов) ─────────────────────────────────────────────

  async saveMessage(
    contactId: string,
    channel: Channel,
    userText: string,
    assistantText: string,
    tokensUsed: number,
  ): Promise<void> {
    let conversation = await this.conversation.findFirst({
      where: { contactId, channel },
      orderBy: { createdAt: 'desc' },
    });

    if (!conversation) {
      conversation = await this.conversation.create({ data: { contactId, channel } });
    }

    await this.message.createMany({
      data: [
        { conversationId: conversation.id, role: 'USER', content: userText },
        { conversationId: conversation.id, role: 'ASSISTANT', content: assistantText, tokensUsed },
      ],
    });

    await this.logActivity(contactId, 'MESSAGE_RECEIVED', `Сообщение через ${channel}`);
  }

  // ─── Business Profile ──────────────────────────────────────────────────────

  async getBusinessProfile(tenantId: string) {
    return this.businessProfile.upsert({
      where: { tenantId },
      create: { tenantId, name: '', agentContext: '' },
      update: {},
    });
  }

  async updateBusinessProfile(tenantId: string, data: { name?: string; agentContext?: string; chatHistory?: string; greenApiInstanceId?: string; greenApiToken?: string; instagramAccountId?: string; instagramAccessToken?: string }) {
    return this.businessProfile.upsert({
      where: { tenantId },
      create: { tenantId, name: data.name ?? '', agentContext: data.agentContext ?? '' },
      update: data,
    });
  }

  // ─── Utils ─────────────────────────────────────────────────────────────────

  private async findOrThrow(tenantId: string, id: string): Promise<Contact> {
    const contact = await this.contact.findFirst({ where: { id, tenantId } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  private async logActivity(
    contactId: string,
    type: ActivityType,
    description: string,
    metadata?: object,
  ): Promise<void> {
    await this.activityLog.create({
      data: { contactId, type, description, metadata: metadata ?? undefined },
    });
  }
}
