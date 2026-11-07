import { CrmService } from '../src/crm/crm.service';

const PARALLEL = Number(process.argv[2] ?? 10);
const TENANT_ID = 'race-lab-tenant';
const PHONE = '+996700000001';

async function main() {
  const crm = new CrmService();
  await crm.$connect();

  await crm.tenant.upsert({ where: { id: TENANT_ID }, create: { id: TENANT_ID, name: 'Race lab' }, update: {} });
  const old = await crm.contact.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } });
  await crm.activityLog.deleteMany({ where: { contactId: { in: old.map((c) => c.id) } } });
  await crm.contact.deleteMany({ where: { tenantId: TENANT_ID } });

  console.log(`${PARALLEL} webhooks от нового клиента ${PHONE} приходят одновременно\n`);

  const results = await Promise.allSettled(
    Array.from({ length: PARALLEL }, () => crm.upsertContact(TENANT_ID, { phone: PHONE })),
  );

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') console.log(`  сообщение #${i + 1}: OK   → контакт ${r.value.id}`);
    else console.log(`  сообщение #${i + 1}: FAIL → ${(r.reason as any).code ?? ''} ${String((r.reason as any).message).split('\n').pop()}`);
  });

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const ids = new Set(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.id] : [])));
  const inDb = await crm.contact.count({ where: { tenantId: TENANT_ID, phone: PHONE } });

  console.log(`\nИтог: обработано ${ok}/${PARALLEL}, потеряно ${PARALLEL - ok}; разных id у успешных: ${ids.size}; контактов в БД: ${inDb}`);
  await crm.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
