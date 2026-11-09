export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const FOLLOW_UP = /^(а|и|ну|так|ещё|еще)\s/i;
const MIN_STANDALONE_WORDS = 4;

// Упрощение для демо без ключа LLM: в проде это короткий вызов дешёвой модели
// («перепиши последний вопрос так, чтобы он был понятен без истории»).
export function rewriteQuery(history: ChatTurn[], question: string): string {
  const previous = [...history].reverse().find((t) => t.role === 'user');
  const words = question.trim().split(/\s+/).length;
  const needsContext = FOLLOW_UP.test(question.trim()) || words < MIN_STANDALONE_WORDS;
  if (!previous || !needsContext) return question;
  return `${previous.text.replace(/[?.!]+$/, '')}; ${question.replace(/^(а|и|ну|так)\s+/i, '')}`;
}

// Упрощение: в агентном RAG модель сама решает, на какие подзапросы разбить вопрос.
export function splitQuestion(question: string): string[] {
  const parts = question
    .split(/\?|\s+и\s+(?=(?:есть|сколько|можно|какая|какой|когда|где)\s)/i)
    .filter((p): p is string => !!p && p.trim().split(/\s+/).length >= 3)
    .map((p) => p.trim());
  return parts.length > 1 ? parts : [question];
}
