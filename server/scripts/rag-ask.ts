import { CrmService } from '../src/crm/crm.service';
import { KnowledgeService, RankedHit, buildPrompt, RERANK_MIN_SCORE } from '../src/knowledge/knowledge.service';
import { rewriteQuery, splitQuestion } from '../src/knowledge/query-rewrite';

const SHOP = 'rag-pipe-electronics';
const [question, previous] = process.argv.slice(2);

const short = (s: string, n = 75) => s.replace(/\n/g, ' ').slice(0, n);
const show = (hits: RankedHit[], score: (h: RankedHit) => string) =>
  hits.length ? hits.forEach((h, i) => console.log(`     ${i + 1}. ${score(h)}  [${h.source}] ${short(h.content)}`)) : console.log('     (ничего)');

async function main() {
  if (!question) {
    console.log('Использование: npx ts-node --transpile-only scripts/rag-ask.ts "вопрос клиента" ["предыдущий вопрос"]');
    process.exit(1);
  }
  const db = new CrmService();
  const kb = new KnowledgeService(db);

  console.log(`\nКлиент пишет: «${question}»${previous ? `   (до этого спрашивал: «${previous}»)` : ''}`);

  console.log('\n⑤ ПЕРЕПИСАТЬ');
  const rewritten = previous ? rewriteQuery([{ role: 'user', text: previous }], question) : question;
  console.log(rewritten === question ? '   без изменений (вопрос понятен сам по себе)' : `   → «${rewritten}»`);
  const subs = splitQuestion(rewritten);
  if (subs.length > 1) console.log(`   разбит на подзапросы: ${subs.map((s) => `«${s}»`).join(', ')}`);

  const kept: RankedHit[] = [];
  for (const q of subs) {
    if (subs.length > 1) console.log(`\n   ── подзапрос «${q}» ──`);
    console.log('\n⑥ НАЙТИ КАНДИДАТОВ (только в документах этого магазина)');
    console.log('   по смыслу (вектор):');
    show((await kb.searchVector(SHOP, q, 3)) as RankedHit[], (h) => Number(h.similarity).toFixed(3));
    console.log('   по словам (tsvector):');
    show((await kb.searchKeyword(SHOP, q, 3)) as RankedHit[], (h) => Number(h.similarity).toFixed(3));
    const candidates = await kb.searchHybrid(SHOP, q, 6);
    console.log('   hybrid (слили два списка):');
    show(candidates.slice(0, 3), (h) => `вектор #${h.vectorRank ?? '—'} слова #${h.keywordRank ?? '—'}`);

    console.log(`\n⑦ RERANK (порог ${RERANK_MIN_SCORE})`);
    const r = await kb.rerank(q, candidates);
    show(r.all.slice(0, 4), (h) => `${h.rerank!.toFixed(2).padStart(6)} ${h.rerank! >= RERANK_MIN_SCORE ? '✓' : '✗'}`);
    kept.push(...r.kept.filter((h) => !kept.some((k) => k.id === h.id)));
  }

  console.log('\n⑧ ЧТО УХОДИТ В CLAUDE');
  if (!kept.length) {
    console.log('   ничего не прошло порог → агент отвечает «уточню у менеджера», LLM не вызывается');
  } else {
    buildPrompt(kept, rewritten).split('\n').forEach((l) => console.log(`   │ ${l}`));
    console.log('   (ключа Claude нет — дальше модель ответила бы по этим документам, а guardrail проверил бы ответ)');
  }
  await db.$disconnect();
}

main();
