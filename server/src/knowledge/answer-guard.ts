export interface GuardResult {
  ok: boolean;
  problems: string[];
}

const URL = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?/gi;
const PRICE = /(\d[\d\s]*\d|\d)\s*сом/gi;

const normalizeNumber = (s: string) => s.replace(/\s+/g, '');

export function checkAnswer(answer: string, sources: string[], allowedDomains: string[]): GuardResult {
  const problems: string[] = [];
  const sourceText = sources.join('\n');
  const sourcePrices = new Set([...sourceText.matchAll(PRICE)].map((m) => normalizeNumber(m[1])));

  for (const [, domain] of answer.matchAll(URL)) {
    const host = domain.toLowerCase();
    if (!allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
      problems.push(`ссылка на чужой домен: ${host}`);
    }
  }
  for (const [, amount] of answer.matchAll(PRICE)) {
    if (!sourcePrices.has(normalizeNumber(amount))) {
      problems.push(`сумма «${amount.trim()} сом» не встречается в найденных источниках`);
    }
  }
  return { ok: problems.length === 0, problems };
}
