import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const FAKE = 'http://localhost:4010';
const SHOPS = [
  { tenantId: 'ig-lab-shop-a', name: 'Магазин A', accountId: 'ig-acc-111', token: 'token-shop-a' },
  { tenantId: 'ig-lab-shop-b', name: 'Магазин B', accountId: 'ig-acc-222', token: 'token-shop-b' },
];

const dm = (accountId: string, senderId: string, text: string) =>
  fetch('http://localhost:3001/webhooks/instagram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      object: 'instagram',
      entry: [{ id: accountId, messaging: [{ sender: { id: senderId }, recipient: { id: accountId }, timestamp: Date.now(), message: { mid: `mid-${Math.random()}`, text } }] }],
    }),
  });

async function main() {
  await fetch(`${FAKE}/__reset`, { method: 'POST' });
  for (const s of SHOPS) {
    await db.tenant.upsert({ where: { id: s.tenantId }, create: { id: s.tenantId, name: s.name }, update: {} });
    await db.businessProfile.upsert({
      where: { tenantId: s.tenantId },
      create: { tenantId: s.tenantId, name: s.name, instagramAccountId: s.accountId, instagramAccessToken: s.token },
      update: { instagramAccountId: s.accountId, instagramAccessToken: s.token },
    });
  }
  await db.contact.deleteMany({ where: { instagramId: { startsWith: 'ig-user-' } } });

  console.log('DM в аккаунт магазина A, DM в аккаунт магазина B, DM в неизвестный аккаунт\n');
  await dm('ig-acc-111', 'ig-user-aibek', 'Есть айфоны?');
  await dm('ig-acc-222', 'ig-user-dana', 'Есть доставка?');
  await dm('ig-acc-999', 'ig-user-x', 'Привет');
  await new Promise((r) => setTimeout(r, 6000));

  const contacts = await db.contact.findMany({ where: { instagramId: { startsWith: 'ig-user-' } }, select: { instagramId: true, tenantId: true } });
  console.log('Куда попали контакты:');
  contacts.forEach((c) => console.log(`  ${(c.instagramId ?? "").padEnd(15)} → ${c.tenantId}`));
  const state = await (await fetch(`${FAKE}/__state`)).json();
  console.log('\nОтветы ушли через:');
  state.sent.forEach((s: any) => console.log(`  ${s.chatId}`));
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
