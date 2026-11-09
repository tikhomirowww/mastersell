import { CrmService } from '../../crm/crm.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';

export interface AgentContext {
  tenantId: string;
  contactId: string;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export const TOOL_DEFINITIONS = [
  {
    name: 'search_knowledge',
    description: 'Найти в документах магазина ответ на вопрос клиента: доставка, оплата, гарантия, наличие и цены товаров.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Поисковый запрос на русском' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_product',
    description: 'Получить товар по артикулу (5 цифр).',
    input_schema: {
      type: 'object',
      properties: { article: { type: 'string', pattern: '^\\d{5}$' } },
      required: ['article'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_lead',
    description: 'Оформить заявку: клиент хочет купить конкретный товар. Менеджер свяжется для оплаты.',
    input_schema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'Товар, который хочет клиент' },
        note: { type: 'string', description: 'Детали для менеджера' },
      },
      required: ['product'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoff_to_human',
    description: 'Передать диалог менеджеру: вопрос вне компетенции, жалоба, просьба о скидке или подозрительный запрос.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
      additionalProperties: false,
    },
  },
] as const;

type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

function validate(name: string, input: Record<string, unknown>): string | null {
  const def = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!def) return `неизвестный инструмент ${name}`;
  const allowed = Object.keys(def.input_schema.properties);
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length) return `недопустимые поля: ${extra.join(', ')}`;
  const missing = (def.input_schema.required as readonly string[]).filter((k) => typeof input[k] !== 'string' || !input[k]);
  if (missing.length) return `не заполнены поля: ${missing.join(', ')}`;
  if (name === 'get_product' && !/^\d{5}$/.test(String(input.article))) return 'артикул должен быть из 5 цифр';
  return null;
}

export class ToolExecutor {
  constructor(
    private readonly crm: CrmService,
    private readonly kb: KnowledgeService,
  ) {}

  async execute(ctx: AgentContext, name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const error = validate(name, input);
    if (error) return { content: `Ошибка: ${error}`, isError: true };

    switch (name as ToolName) {
      case 'search_knowledge': {
        const hits = await this.kb.retrieve(ctx.tenantId, String(input.query));
        if (!hits.length) return { content: 'Ничего не найдено в документах магазина.' };
        return { content: hits.map((h) => `[${h.source}] ${h.content}`).join('\n') };
      }
      case 'get_product': {
        const rows = await this.crm.$queryRaw<{ content: string }[]>`
          SELECT content FROM knowledge_chunks
          WHERE tenant_id = ${ctx.tenantId} AND source = 'catalog.md' AND content LIKE ${`%арт. ${input.article}%`}`;
        return rows.length ? { content: `[catalog.md] ${rows[0].content}` } : { content: `Товар с артикулом ${input.article} не найден.` };
      }
      case 'create_lead': {
        await this.crm.updateStage(ctx.tenantId, ctx.contactId, 'INTERESTED');
        const note = await this.crm.createNote(ctx.tenantId, ctx.contactId, {
          text: `Заявка от AI-агента: ${input.product}${input.note ? `. ${input.note}` : ''}`,
        });
        return { content: `Заявка создана (заметка ${note.id.slice(0, 8)}), стадия контакта: INTERESTED.` };
      }
      case 'handoff_to_human': {
        await this.crm.createNote(ctx.tenantId, ctx.contactId, { text: `Передано менеджеру: ${input.reason}` });
        return { content: 'Диалог передан менеджеру.' };
      }
    }
  }
}
