import * as http from 'http';

let claudeMode: 'ok' | 'down' = 'ok';
let claudeDelayMs = 1500;
const sent: { chatId: string; message: string; at: string }[] = [];
let claudeCalls = 0;

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<any>((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });

http
  .createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === '/v1/messages') {
      claudeCalls++;
      await new Promise((r) => setTimeout(r, claudeDelayMs));
      if (claudeMode === 'down') return json(res, 500, { type: 'error', error: { type: 'api_error', message: 'fake outage' } });
      return json(res, 200, {
        id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'iPhone 15 сейчас стоит 89 990 сом, есть в наличии.' }],
        usage: { input_tokens: 120, output_tokens: 25 },
      });
    }
    if (req.url?.includes('/sendMessage/')) {
      sent.push({ chatId: body.chatId, message: body.message, at: new Date().toISOString().slice(11, 19) });
      return json(res, 200, { idMessage: `out_${sent.length}` });
    }
    if (req.url === '/__mode') {
      claudeMode = body.claude ?? claudeMode;
      claudeDelayMs = body.delayMs ?? claudeDelayMs;
      return json(res, 200, { claudeMode, claudeDelayMs });
    }
    if (req.url === '/__state') return json(res, 200, { claudeMode, claudeCalls, sent });
    if (req.url === '/__reset') { sent.length = 0; claudeCalls = 0; claudeMode = 'ok'; claudeDelayMs = 1500; return json(res, 200, {}); }
    json(res, 404, {});
  })
  .listen(4010, () => console.log('fake Claude + GreenAPI on :4010'));
