const API = 'http://localhost:3001';

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

async function shop(label: string) {
  const email = `${label}-${Date.now()}@lab.test`;
  const { status, data } = await call('POST', '/auth/register', undefined, { email, password: 'Password123' });
  if (!data?.token) throw new Error(`register failed: ${status} ${JSON.stringify(data)}`);
  const contact = await call('POST', '/crm/contacts', data.token, { phone: `+99655500${Math.floor(Math.random() * 9000 + 1000)}`, name: `Клиент магазина ${label}` });
  await call('POST', `/crm/contacts/${contact.data.id}/notes`, data.token, { text: `Секрет ${label}: готов платить до 120 000` });
  return { token: data.token as string, contactId: contact.data.id as string };
}

async function main() {
  const A = await shop('A');
  const B = await shop('B');
  console.log(`Менеджер магазина A пытается добраться до контакта магазина B (${B.contactId})\n`);

  const checks: [string, string, string, unknown?][] = [
    ['прочитать карточку', 'GET', `/crm/contacts/${B.contactId}`],
    ['прочитать заметки', 'GET', `/crm/contacts/${B.contactId}/notes`],
    ['изменить имя', 'PUT', `/crm/contacts/${B.contactId}`, { name: 'ВЗЛОМАНО магазином A' }],
    ['сменить стадию', 'PUT', `/crm/contacts/${B.contactId}/stage`, { stage: 'LOST' }],
    ['добавить заметку', 'POST', `/crm/contacts/${B.contactId}/notes`, { text: 'заметка от чужого магазина' }],
  ];

  let leaks = 0;
  for (const [what, method, path, body] of checks) {
    const r = await call(method, path, A.token, body);
    const leaked = r.status < 400;
    if (leaked) leaks++;
    const detail = leaked ? JSON.stringify(r.data).slice(0, 90) : r.data?.message ?? '';
    console.log(`  ${leaked ? 'УТЕЧКА' : 'ок    '}  ${what.padEnd(18)} → ${r.status}  ${detail}`);
  }

  const own = await call('GET', `/crm/contacts/${A.contactId}`, A.token);
  console.log(`\n  контроль: свой контакт → ${own.status}`);
  const noTenant = await call('GET', '/crm/contacts', undefined);
  console.log(`  без токена → ${noTenant.status}`);

  console.log(`\nИтог: ${leaks === 0 ? 'изоляция работает' : `${leaks} из ${checks.length} операций над чужим контактом прошли`}`);
  process.exit(leaks === 0 && own.status === 200 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
