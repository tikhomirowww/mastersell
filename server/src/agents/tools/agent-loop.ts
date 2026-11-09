import Anthropic from '@anthropic-ai/sdk';
import { checkAnswer } from '../../knowledge/answer-guard';
import { AgentContext, TOOL_DEFINITIONS, ToolExecutor } from './tools';

export const MAX_STEPS = 4;

export type AgentEvent =
  | { type: 'model_call'; step: number }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; content: string; isError?: boolean }
  | { type: 'final'; text: string }
  | { type: 'guard_block'; problems: string[] }
  | { type: 'step_limit' };

const SYSTEM = [
  'Ты консультант магазина электроники. Отвечай кратко.',
  'Факты (цены, наличие, доставка) бери ТОЛЬКО из результатов инструментов, не из памяти.',
  'Скидки и особые условия не обещай — для этого handoff_to_human.',
].join('\n');

export async function runAgent(
  client: Anthropic,
  executor: ToolExecutor,
  ctx: AgentContext,
  userText: string,
  opts: { model: string; allowedDomains: string[]; onEvent: (e: AgentEvent) => void },
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userText }];
  const sources: string[] = [];

  for (let step = 1; step <= MAX_STEPS; step++) {
    opts.onEvent({ type: 'model_call', step });
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOL_DEFINITIONS as unknown as Anthropic.Tool[],
      messages,
    });
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const guard = checkAnswer(text, sources, opts.allowedDomains);
      if (!guard.ok) {
        opts.onEvent({ type: 'guard_block', problems: guard.problems });
        return 'Уточню у менеджера и вернусь к вам.';
      }
      opts.onEvent({ type: 'final', text });
      return text;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      opts.onEvent({ type: 'tool_call', name: block.name, input: block.input });
      const result = await executor.execute(ctx, block.name, block.input as Record<string, unknown>);
      if (!result.isError) sources.push(result.content);
      opts.onEvent({ type: 'tool_result', name: block.name, ...result });
      results.push({ type: 'tool_result', tool_use_id: block.id, content: result.content, is_error: result.isError });
    }
    messages.push({ role: 'user', content: results });
  }

  opts.onEvent({ type: 'step_limit' });
  return 'Уточню у менеджера и вернусь к вам.';
}
