import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3001/webhooks/whatsapp';
const FAKE = 'http://localhost:4010';
const INSTANCE = 7700001;
const TENANT_ID = 'webhook-lab-tenant';
const db = new PrismaClient();

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const webhook = (idMessage: string, text: string, phone = '996700000002') =>
  post(API, {
    typeWebhook: 'incomingMessageReceived',
    idMessage,
    instanceData: { idInstance: INSTANCE },
    senderData: { chatId: `${phone}@c.us`, senderName: 'Айбек' },
    messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: text } },
  }).then((r) => r.status);

async function report() {
  const state = await (await fetch(`${FAKE}/__state`)).json();
  const rows = await db.processedMessage.findMany({ where: { id: { startsWith: `greenapi:${INSTANCE}:` } }, orderBy: { startedAt: 'asc' } });
  console.log(`\nВызовов Claude: ${state.claudeCalls}`);
  console.log(`Отправлено клиенту ответов: ${state.sent.length}`);
  state.sent.forEach((s: any) => console.log(`  ${s.at} → ${s.message}`));
  console.log('processed_messages:');
  rows.forEach((r) => console.log(`  ${r.id.split(':').pop()}  ${r.status}`));
}

async function reset() {
  await post(`${FAKE}/__reset`, {});
  await db.tenant.upsert({ where: { id: TENANT_ID }, create: { id: TENANT_ID, name: 'Webhook lab' }, update: {} });
  await db.businessProfile.upsert({
    where: { tenantId: TENANT_ID },
    create: { tenantId: TENANT_ID, name: 'Webhook lab', greenApiInstanceId: String(INSTANCE), greenApiToken: 'fake-token' },
    update: {},
  });
  await db.processedMessage.deleteMany({ where: { id: { startsWith: `greenapi:${INSTANCE}:` } } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const scenario = process.argv[2];

  if (scenario === 'duplicate') {
    await reset();
    console.log('Один и тот же webhook (id m-1) прилетает 3 раза одновременно + ещё раз через 2 сек');
    const statuses = await Promise.all([webhook('m-1', 'Сколько стоит iPhone 15?'), webhook('m-1', 'Сколько стоит iPhone 15?'), webhook('m-1', 'Сколько стоит iPhone 15?')]);
    console.log(`HTTP-ответы провайдеру: ${statuses.join(', ')}`);
    await sleep(2000);
    console.log(`Повтор через 2 сек: ${await webhook('m-1', 'Сколько стоит iPhone 15?')}`);
    await sleep(4000);
  } else if (scenario === 'outage') {
    await reset();
    await post(`${FAKE}/__mode`, { claude: 'down', delayMs: 200 });
    console.log('Claude ЛЕЖИТ. Клиент пишет m-2');
    console.log(`HTTP-ответ провайдеру: ${await webhook('m-2', 'Есть доставка в Ош?')}`);
    await sleep(12000);
    await post(`${FAKE}/__mode`, { claude: 'ok' });
    console.log('\n…через 12 сек Claude ПОДНЯЛСЯ');
    await sleep(20000);
  } else if (scenario === 'restart-send') {
    await reset();
    await post(`${FAKE}/__mode`, { claude: 'ok', delayMs: 8000 });
    console.log('Claude медленный (8 сек). Шлём 3 сообщения, потом сервер убьют');
    for (const id of ['r-1', 'r-2', 'r-3']) console.log(`  ${id}: HTTP ${await webhook(id, `Вопрос ${id}`, `99670000010${id.slice(-1)}`)}`);
    return db.$disconnect();
  } else if (scenario !== 'report') {
    console.log('usage: webhook-demo.ts duplicate | outage | restart-send | report');
    return db.$disconnect();
  }

  await report();
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
