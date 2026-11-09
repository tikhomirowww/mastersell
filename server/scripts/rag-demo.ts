import { CrmService } from '../src/crm/crm.service';
import { KnowledgeService, chunkText } from '../src/knowledge/knowledge.service';
import { embedQuery } from '../src/knowledge/embeddings';

const ELECTRONICS = 'rag-lab-electronics';
const FLOWERS = 'rag-lab-flowers';
const MIN_SIMILARITY = Number(process.env.MIN_SIMILARITY ?? 0.82);

const DOCS: Record<string, Record<string, string>> = {
  [ELECTRONICS]: {
    'delivery.md': `Доставка по Бишкеку бесплатная при заказе от 5 000 сом, иначе 250 сом. Привозим в день заказа, если оформили до 15:00.

Отправка в регионы Кыргызстана (Ош, Джалал-Абад, Каракол) — 400 сом, срок 2–3 рабочих дня, через СДЭК. Оплата при получении не доступна для регионов.`,
    'prices.md': `iPhone 15 128 ГБ — 89 990 сом. iPhone 15 Pro 256 ГБ — 129 990 сом. Samsung Galaxy S24 — 74 990 сом.

Рассрочка 0% на 6 месяцев через Компаньон Банк при покупке от 30 000 сом.`,
    'warranty.md': `Официальная гарантия на всю технику — 12 месяцев. Возврат в течение 14 дней, если сохранена упаковка и товар не был в использовании.`,
  },
  [FLOWERS]: {
    'delivery.md': `Доставка букетов по Бишкеку — 200 сом, за город — от 500 сом. Доставка за 2 часа. В регионы не доставляем: цветы не переносят долгую дорогу.`,
    'catalog.md': `Букет из 25 роз — 3 500 сом. Букет из 51 розы — 6 900 сом. Тюльпаны — 120 сом за штуку.`,
  },
};

async function main() {
  const db = new CrmService();
  const kb = new KnowledgeService(db);

  console.log('━━ 1. ИНДЕКСАЦИЯ (один раз при загрузке документов) ━━');
  for (const [tenantId, files] of Object.entries(DOCS)) {
    await db.tenant.upsert({ where: { id: tenantId }, create: { id: tenantId, name: tenantId }, update: {} });
    for (const [source, text] of Object.entries(files)) {
      const n = await kb.ingest(tenantId, source, text);
      console.log(`  ${tenantId} / ${source}: ${n} чанк(а)`);
    }
  }
  const sample = chunkText(DOCS[ELECTRONICS]['delivery.md'])[0];
  const vec = await embedQuery('пример');
  console.log(`\n  чанк = кусок текста: «${sample.slice(0, 60)}…»`);
  console.log(`  embedding = ${vec.length} чисел: [${vec.slice(0, 4).map((x) => x.toFixed(3)).join(', ')}, …]`);

  const ask = async (title: string, tenantId: string, q: string) => {
    console.log(`\n━━ ${title} ━━\n  Вопрос клиента: «${q}»`);
    const hits = await kb.search(tenantId, q);
    hits.forEach((h) => console.log(`  ${Number(h.similarity).toFixed(3)}  [${h.source}] ${h.content.slice(0, 70).replace(/\n/g, ' ')}…`));
    const good = hits.filter((h) => Number(h.similarity) >= MIN_SIMILARITY);
    if (!good.length) console.log(`  → ниже порога ${MIN_SIMILARITY}: агент говорит «уточню у менеджера», а не выдумывает`);
    return good;
  };

  await ask('2. ПОИСК ПО СМЫСЛУ (магазин электроники)', ELECTRONICS, 'Вы отправляете в Ош? Сколько это стоит?');
  await ask('3. ТОТ ЖЕ ПОИСК, другие слова', ELECTRONICS, 'можно взять телефон частями, без полной оплаты?');

  console.log('\n━━ 4. БЕЗ ФИЛЬТРА ПО ТЕНАНТУ (ошибка) ━━\n  Вопрос клиента электроники: «Сколько стоит доставка по городу?»');
  const v = `[${(await embedQuery('Сколько стоит доставка по городу?')).join(',')}]`;
  const leaked = await db.$queryRawUnsafe<{ tenant_id: string; source: string; content: string; similarity: number }[]>(
    `SELECT tenant_id, source, content, 1 - (embedding <=> $1::vector) AS similarity
     FROM knowledge_chunks WHERE tenant_id LIKE 'rag-lab-%' ORDER BY embedding <=> $1::vector LIMIT 3`, v);
  leaked.forEach((h) => console.log(`  ${Number(h.similarity).toFixed(3)}  ${h.tenant_id === FLOWERS ? 'ЧУЖОЙ → ' : '         '}[${h.tenant_id}/${h.source}] ${h.content.slice(0, 55)}…`));

  const good = await ask('5. ВОПРОС НЕ ПО ТЕМЕ', ELECTRONICS, 'Какая погода будет завтра в Бишкеке?');

  console.log('\n━━ 6. ЧТО РЕАЛЬНО УХОДИТ В CLAUDE ━━');
  const q = 'Вы отправляете в Ош? Сколько это стоит?';
  const ctx = (await kb.search(ELECTRONICS, q)).filter((h) => Number(h.similarity) >= MIN_SIMILARITY);
  console.log(`  system: Ты консультант магазина. Отвечай ТОЛЬКО по фрагментам ниже. Если ответа в них нет — скажи, что уточнишь у менеджера.
${ctx.map((h, i) => `  [${i + 1}] (${h.source}) ${h.content.replace(/\n+/g, ' ')}`).join('\n')}
  user: ${q}`);

  void good;
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
