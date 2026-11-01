import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const base = process.env.GATEWAY_BASE_URL || 'http://127.0.0.1:8080';
const key = process.env.GATEWAY_API_KEY || (await readFile(process.env.GATEWAY_KEY_FILE || '.local/gateway-key.txt', 'utf8')).trim();
const protocol = process.argv[2] || 'chat';
const model = process.argv[3] || 'entire-codex';
const path = { chat: '/v1/chat/completions', anthropic: '/v1/messages', responses: '/v1/responses' }[protocol];
if (!path) throw new Error('Use chat, anthropic or responses as the first argument.');
const body = protocol === 'responses' ? { model, input: 'Reply with exactly ENTIRE2API_OK.', max_output_tokens: 32 } : { model, messages: [{ role: 'user', content: 'Reply with exactly ENTIRE2API_OK.' }], max_tokens: 32 };
const idempotencyKey = process.env.SMOKE_IDEMPOTENCY_KEY || `smoke-${randomUUID()}`;
const response = await fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
const value = await response.json();
const text = protocol === 'chat' ? value.choices?.[0]?.message?.content : protocol === 'anthropic' ? value.content?.[0]?.text : value.output?.[0]?.content?.[0]?.text;
const evidence = { time: new Date().toISOString(), protocol, model, idempotencyKey, status: response.status, runId: response.headers.get('x-entire-run-id'), answer: text, error: value.error, passed: response.ok && text === 'ENTIRE2API_OK' };
await mkdir('.local/evidence', { recursive: true });
await writeFile(`.local/evidence/${Date.now()}-${protocol}.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(JSON.stringify(evidence));
if (!evidence.passed) process.exitCode = 1;
