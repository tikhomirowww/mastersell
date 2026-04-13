import { Injectable } from '@nestjs/common';
import { ClaudeService } from '../../lib/claude/claude.service';

export type Intent =
  | 'GREETING'      // приветствие
  | 'QUESTION'      // вопрос об услуге/продукте
  | 'PRICE_INQUIRY' // спрашивает цену
  | 'OBJECTION'     // возражение
  | 'READY_TO_BUY'  // готов купить
  | 'COMPLAINT'     // жалоба
  | 'FAREWELL'      // прощание
  | 'HUMAN_NEEDED'  // хочет человека
  | 'OTHER';

const CLASSIFY_PROMPT = `Ты классификатор намерений. Определи намерение сообщения клиента.
Ответь ОДНИМ словом из списка:
GREETING, QUESTION, PRICE_INQUIRY, OBJECTION, READY_TO_BUY, COMPLAINT, FAREWELL, HUMAN_NEEDED, OTHER

Правила:
- Если клиент спрашивает цену, стоимость, сколько стоит → PRICE_INQUIRY
- Если клиент говорит "дорого", "подумаю", "не уверен" → OBJECTION
- Если клиент говорит "хочу купить", "оформите", "давайте" → READY_TO_BUY
- Если клиент хочет оператора/человека → HUMAN_NEEDED`;

@Injectable()
export class ClassifierService {
  constructor(private readonly claude: ClaudeService) {}

  async classify(message: string): Promise<Intent> {
    const result = await this.claude.classify(CLASSIFY_PROMPT, message);
    const intent = result.toUpperCase() as Intent;

    const validIntents: Intent[] = [
      'GREETING', 'QUESTION', 'PRICE_INQUIRY', 'OBJECTION',
      'READY_TO_BUY', 'COMPLAINT', 'FAREWELL', 'HUMAN_NEEDED', 'OTHER',
    ];

    return validIntents.includes(intent) ? intent : 'OTHER';
  }
}
