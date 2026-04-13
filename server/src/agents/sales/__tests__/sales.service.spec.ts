import { Test, TestingModule } from '@nestjs/testing';
import { SalesService, IncomingMessage, AgentReply } from '../sales.service';
import { ClaudeService } from '../../../lib/claude/claude.service';
import { SessionService, SessionData } from '../../../memory/session.service';
import { ClassifierService } from '../../classifier/classifier.service';

describe('SalesService', () => {
  let service: SalesService;
  let claudeMock: jest.Mocked<Pick<ClaudeService, 'chat' | 'summarizeHistory'>>;
  let sessionMock: jest.Mocked<
    Pick<SessionService, 'appendMessage' | 'needsSummarization' | 'updateSummary'>
  >;
  let classifierMock: jest.Mocked<Pick<ClassifierService, 'classify'>>;

  const baseSession: SessionData = {
    contactId: 'contact-1',
    channel: 'WHATSAPP',
    language: 'RU',
    messages: [{ role: 'user', content: 'Привет' }],
    summary: undefined,
  };

  const baseIncoming: IncomingMessage = {
    sessionId: 'session-abc',
    contactId: 'contact-1',
    tenantId: 'test-tenant',
    channel: 'WHATSAPP',
    language: 'RU',
    text: 'Привет, расскажи о продукте',
  };

  beforeEach(async () => {
    claudeMock = {
      chat: jest.fn(),
      summarizeHistory: jest.fn(),
    };

    sessionMock = {
      appendMessage: jest.fn(),
      needsSummarization: jest.fn(),
      updateSummary: jest.fn(),
    };

    classifierMock = {
      classify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: ClaudeService, useValue: claudeMock },
        { provide: SessionService, useValue: sessionMock },
        { provide: ClassifierService, useValue: classifierMock },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
  });

  describe('handle', () => {
    it('возвращает AgentReply с text и intent для обычного сообщения', async () => {
      classifierMock.classify.mockResolvedValue('QUESTION');
      sessionMock.appendMessage.mockResolvedValue(baseSession);
      sessionMock.needsSummarization.mockResolvedValue(false);
      claudeMock.chat.mockResolvedValue({
        content: 'Наш продукт помогает автоматизировать продажи.',
        inputTokens: 100,
        outputTokens: 50,
      });

      const result: AgentReply = await service.handle(baseIncoming);

      expect(result).toMatchObject({
        text: 'Наш продукт помогает автоматизировать продажи.',
        intent: 'QUESTION',
        shouldEscalate: false,
        tokensUsed: 150,
      });
    });

    it('при HUMAN_NEEDED возвращает ответ с shouldEscalate=true и tokensUsed=0', async () => {
      classifierMock.classify.mockResolvedValue('HUMAN_NEEDED');

      const result: AgentReply = await service.handle(baseIncoming);

      expect(result.intent).toBe('HUMAN_NEEDED');
      expect(result.shouldEscalate).toBe(true);
      expect(result.tokensUsed).toBe(0);
      expect(result.text).toBeTruthy();
      // Claude.chat не должен вызываться
      expect(claudeMock.chat).not.toHaveBeenCalled();
    });

    it('при HUMAN_NEEDED на русском языке возвращает русский текст', async () => {
      classifierMock.classify.mockResolvedValue('HUMAN_NEEDED');

      const result = await service.handle({ ...baseIncoming, language: 'RU' });

      expect(result.text).toContain('оператор');
    });

    it('при HUMAN_NEEDED на кыргызском языке возвращает кыргызский текст', async () => {
      classifierMock.classify.mockResolvedValue('HUMAN_NEEDED');

      const result = await service.handle({ ...baseIncoming, language: 'KY' });

      expect(result.text).toContain('оператор');
    });

    it('вызывает summarizeHistory и updateSummary когда нужна суммаризация', async () => {
      classifierMock.classify.mockResolvedValue('GREETING');
      sessionMock.appendMessage.mockResolvedValue(baseSession);
      sessionMock.needsSummarization.mockResolvedValue(true);
      claudeMock.summarizeHistory.mockResolvedValue('Краткое резюме диалога');
      sessionMock.updateSummary.mockResolvedValue(undefined);
      claudeMock.chat.mockResolvedValue({
        content: 'Привет!',
        inputTokens: 80,
        outputTokens: 20,
      });

      await service.handle(baseIncoming);

      expect(claudeMock.summarizeHistory).toHaveBeenCalledWith(baseSession.messages);
      expect(sessionMock.updateSummary).toHaveBeenCalledWith(
        baseIncoming.sessionId,
        'Краткое резюме диалога',
      );
    });

    it('не вызывает summarizeHistory когда суммаризация не нужна', async () => {
      classifierMock.classify.mockResolvedValue('QUESTION');
      sessionMock.appendMessage.mockResolvedValue(baseSession);
      sessionMock.needsSummarization.mockResolvedValue(false);
      claudeMock.chat.mockResolvedValue({
        content: 'Ответ',
        inputTokens: 50,
        outputTokens: 30,
      });

      await service.handle(baseIncoming);

      expect(claudeMock.summarizeHistory).not.toHaveBeenCalled();
      expect(sessionMock.updateSummary).not.toHaveBeenCalled();
    });

    it('сохраняет ответ ассистента в сессию', async () => {
      classifierMock.classify.mockResolvedValue('PRICE_INQUIRY');
      sessionMock.appendMessage.mockResolvedValue(baseSession);
      sessionMock.needsSummarization.mockResolvedValue(false);
      claudeMock.chat.mockResolvedValue({
        content: 'Цена — 5000 рублей.',
        inputTokens: 60,
        outputTokens: 15,
      });

      await service.handle(baseIncoming);

      // appendMessage должен быть вызван дважды: для пользователя и для ассистента
      expect(sessionMock.appendMessage).toHaveBeenCalledTimes(2);
      expect(sessionMock.appendMessage).toHaveBeenLastCalledWith(
        baseIncoming.sessionId,
        { role: 'assistant', content: 'Цена — 5000 рублей.' },
        expect.any(Object),
      );
    });

    it('корректно вычисляет tokensUsed как сумму inputTokens и outputTokens', async () => {
      classifierMock.classify.mockResolvedValue('OBJECTION');
      sessionMock.appendMessage.mockResolvedValue(baseSession);
      sessionMock.needsSummarization.mockResolvedValue(false);
      claudeMock.chat.mockResolvedValue({
        content: 'Понимаю ваше сомнение...',
        inputTokens: 200,
        outputTokens: 75,
      });

      const result = await service.handle(baseIncoming);

      expect(result.tokensUsed).toBe(275);
    });
  });
});
