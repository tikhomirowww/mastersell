import { Test, TestingModule } from '@nestjs/testing';
import { ClassifierService, Intent } from '../classifier.service';
import { ClaudeService } from '../../../lib/claude/claude.service';

describe('ClassifierService', () => {
  let service: ClassifierService;
  let claudeMock: jest.Mocked<Pick<ClaudeService, 'classify'>>;

  beforeEach(async () => {
    claudeMock = {
      classify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassifierService,
        {
          provide: ClaudeService,
          useValue: claudeMock,
        },
      ],
    }).compile();

    service = module.get<ClassifierService>(ClassifierService);
  });

  describe('classify', () => {
    it('возвращает GREETING когда Claude вернул greeting', async () => {
      claudeMock.classify.mockResolvedValue('GREETING');

      const result = await service.classify('Привет!');

      expect(result).toBe('GREETING');
      expect(claudeMock.classify).toHaveBeenCalledTimes(1);
    });

    it('возвращает PRICE_INQUIRY когда Claude вернул price_inquiry в нижнем регистре', async () => {
      claudeMock.classify.mockResolvedValue('price_inquiry');

      const result = await service.classify('Сколько стоит?');

      expect(result).toBe('PRICE_INQUIRY');
    });

    it('возвращает READY_TO_BUY для намерения покупки', async () => {
      claudeMock.classify.mockResolvedValue('READY_TO_BUY');

      const result = await service.classify('Хочу купить');

      expect(result).toBe('READY_TO_BUY');
    });

    it('возвращает HUMAN_NEEDED когда клиент просит оператора', async () => {
      claudeMock.classify.mockResolvedValue('HUMAN_NEEDED');

      const result = await service.classify('Соедините с оператором');

      expect(result).toBe('HUMAN_NEEDED');
    });

    it('возвращает OTHER при неизвестном ответе от Claude', async () => {
      claudeMock.classify.mockResolvedValue('TOTALLY_UNKNOWN_INTENT');

      const result = await service.classify('какой-то странный текст');

      expect(result).toBe('OTHER');
    });

    it('возвращает OTHER при пустом ответе от Claude', async () => {
      claudeMock.classify.mockResolvedValue('');

      const result = await service.classify('');

      expect(result).toBe('OTHER');
    });

    it('корректно обрабатывает все валидные интенты', async () => {
      const validIntents: Intent[] = [
        'GREETING',
        'QUESTION',
        'PRICE_INQUIRY',
        'OBJECTION',
        'READY_TO_BUY',
        'COMPLAINT',
        'FAREWELL',
        'HUMAN_NEEDED',
        'OTHER',
      ];

      for (const intent of validIntents) {
        claudeMock.classify.mockResolvedValue(intent);
        const result = await service.classify('тест');
        expect(result).toBe(intent);
      }
    });

    it('передаёт сообщение пользователя в ClaudeService.classify', async () => {
      claudeMock.classify.mockResolvedValue('QUESTION');

      const userMessage = 'Расскажите о вашем продукте';
      await service.classify(userMessage);

      expect(claudeMock.classify).toHaveBeenCalledWith(
        expect.any(String),
        userMessage,
      );
    });
  });
});
