import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CrmService } from '../crm.service';
import { ContactsQueryDto, CreateContactDto } from '../dto/contact.dto';

/**
 * CrmService наследует PrismaClient, поэтому нельзя использовать стандартный DI-мок.
 * Вместо этого создаём экземпляр сервиса и мокаем методы PrismaClient через jest.spyOn
 * прямо на экземпляре после его создания.
 */
describe('CrmService', () => {
  let service: CrmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmService],
    }).compile();

    service = module.get<CrmService>(CrmService);

    // Предотвращаем реальное подключение к БД
    jest.spyOn(service, '$connect' as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── getContacts ────────────────────────────────────────────────────────────

  describe('getContacts', () => {
    it('возвращает paginated результат с meta', async () => {
      const fakeContacts = [
        { id: '1', name: 'Иван', phone: '+7999', stage: 'NEW', updatedAt: new Date() },
        { id: '2', name: 'Мария', phone: '+7888', stage: 'CONTACTED', updatedAt: new Date() },
      ];

      jest.spyOn(service.contact, 'findMany').mockResolvedValue(fakeContacts as any);
      jest.spyOn(service.contact, 'count').mockResolvedValue(2);

      const query: ContactsQueryDto = { page: 1, limit: 20 };
      const result = await service.getContacts("test-tenant", query);

      expect(result.data).toEqual(fakeContacts);
      expect(result.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('корректно вычисляет totalPages при большом количестве контактов', async () => {
      jest.spyOn(service.contact, 'findMany').mockResolvedValue([]);
      jest.spyOn(service.contact, 'count').mockResolvedValue(45);

      const result = await service.getContacts("test-tenant", { page: 1, limit: 20 });

      expect(result.meta.totalPages).toBe(3);
    });

    it('применяет поиск по имени когда передан search', async () => {
      jest.spyOn(service.contact, 'findMany').mockResolvedValue([]);
      jest.spyOn(service.contact, 'count').mockResolvedValue(0);

      await service.getContacts("test-tenant", { search: 'Иван' });

      expect(service.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.objectContaining({ contains: 'Иван' }) }),
            ]),
          }),
        }),
      );
    });

    it('фильтрует по stage когда передан stage', async () => {
      jest.spyOn(service.contact, 'findMany').mockResolvedValue([]);
      jest.spyOn(service.contact, 'count').mockResolvedValue(0);

      await service.getContacts("test-tenant", { stage: 'NEW' });

      expect(service.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stage: 'NEW' }),
        }),
      );
    });

    it('использует значения page=1 и limit=20 по умолчанию', async () => {
      jest.spyOn(service.contact, 'findMany').mockResolvedValue([]);
      jest.spyOn(service.contact, 'count').mockResolvedValue(0);

      const result = await service.getContacts("test-tenant", {});

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
      expect(service.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });

  // ─── upsertContact ─────────────────────────────────────────────────────────

  describe('upsertContact', () => {
    it('создаёт новый контакт если не найден по телефону', async () => {
      const newContact = { id: 'new-id', phone: '+79991234567', name: null } as any;

      jest.spyOn(service.contact, 'findFirst').mockResolvedValue(null);
      jest.spyOn(service.contact, 'create').mockResolvedValue(newContact);
      jest.spyOn(service.activityLog, 'create').mockResolvedValue({} as any);

      const result = await service.upsertContact("test-tenant", { phone: '+79991234567' });

      expect(service.contact.findFirst).toHaveBeenCalledWith({
        where: { phone: '+79991234567' },
      });
      expect(service.contact.create).toHaveBeenCalledWith({
        data: { phone: '+79991234567' },
      });
      expect(result).toEqual(newContact);
    });

    it('возвращает существующий контакт если найден', async () => {
      const existingContact = { id: 'existing-id', phone: '+79991234567', name: 'Иван' } as any;

      jest.spyOn(service.contact, 'findFirst').mockResolvedValue(existingContact);
      const createSpy = jest.spyOn(service.contact, 'create').mockResolvedValue({} as any);

      const result = await service.upsertContact("test-tenant", { phone: '+79991234567', name: 'Иван' });

      expect(createSpy).not.toHaveBeenCalled();
      expect(result).toEqual(existingContact);
    });

    it('обновляет имя существующего контакта если имя не было задано', async () => {
      const existingContact = { id: 'existing-id', phone: '+79991234567', name: null } as any;
      const updatedContact = { ...existingContact, name: 'Новое имя' } as any;

      jest.spyOn(service.contact, 'findFirst').mockResolvedValue(existingContact);
      jest.spyOn(service.contact, 'update').mockResolvedValue(updatedContact);

      const result = await service.upsertContact("test-tenant", { phone: '+79991234567', name: 'Новое имя' });

      expect(service.contact.update).toHaveBeenCalledWith({
        where: { id: 'existing-id' },
        data: { name: 'Новое имя' },
      });
      expect(result.name).toBe('Новое имя');
    });

    it('логирует активность при создании нового контакта', async () => {
      const newContact = { id: 'new-id', phone: '+79991234567' } as any;

      jest.spyOn(service.contact, 'findFirst').mockResolvedValue(null);
      jest.spyOn(service.contact, 'create').mockResolvedValue(newContact);
      const activitySpy = jest
        .spyOn(service.activityLog, 'create')
        .mockResolvedValue({} as any);

      await service.upsertContact("test-tenant", { phone: '+79991234567' });

      expect(activitySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contactId: 'new-id',
            type: 'CONTACT_CREATED',
          }),
        }),
      );
    });

    it('ищет по instagramId если телефон не передан', async () => {
      jest.spyOn(service.contact, 'findFirst').mockResolvedValue(null);
      jest.spyOn(service.contact, 'create').mockResolvedValue({ id: 'ig-id' } as any);
      jest.spyOn(service.activityLog, 'create').mockResolvedValue({} as any);

      await service.upsertContact("test-tenant", { instagramId: 'user123' });

      expect(service.contact.findFirst).toHaveBeenCalledWith({
        where: { instagramId: 'user123' },
      });
    });
  });

  // ─── createContact ─────────────────────────────────────────────────────────

  describe('createContact', () => {
    it('создаёт контакт и логирует активность', async () => {
      const dto: CreateContactDto = { phone: '+79001234567', name: 'Тест' };
      const createdContact = { id: 'created-id', ...dto } as any;

      jest.spyOn(service.contact, 'create').mockResolvedValue(createdContact);
      jest.spyOn(service.activityLog, 'create').mockResolvedValue({} as any);

      const result = await service.createContact("test-tenant", dto);

      expect(service.contact.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual(createdContact);
      expect(service.activityLog.create).toHaveBeenCalled();
    });
  });

  // ─── getContact ─────────────────────────────────────────────────────────────

  describe('getContact', () => {
    it('выбрасывает NotFoundException если контакт не найден', async () => {
      jest.spyOn(service.contact, 'findFirst').mockResolvedValue(null);

      await expect(service.getContact('tenant-1', 'nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('возвращает контакт если найден', async () => {
      const contact = { id: 'some-id', name: 'Иван' } as any;
      const findFirst = jest.spyOn(service.contact, 'findFirst').mockResolvedValue(contact);

      const result = await service.getContact('tenant-1', 'some-id');

      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'some-id', tenantId: 'tenant-1' } }));

      expect(result).toEqual(contact);
    });
  });
});
