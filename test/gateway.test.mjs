import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { normalize, instructions, extractAnswer, finalEvents } from '../src/protocols.mjs';
import { EntireClient, trustedUrl, configureFromRun } from '../src/entire.mjs';
import { ReceiptStore } from '../src/store.mjs';
import { ReviewAdapter } from '../src/adapter.mjs';
import { createGateway } from '../src/server.mjs';
import { GatewayError } from '../src/errors.mjs';

const config = () => ({ forge: 'et', project: 'test', apiBase: 'https://test.entire.io/api/v1', repositoryId: '1'.repeat(26), environmentId: '2'.repeat(26), trailId: '3'.repeat(26), changeId: '4'.repeat(26), headSha: 'a'.repeat(40), models: { 'entire-codex': { harness: 'codex', model: null } }, runTimeoutMs: 10000, pollMs: 1, maxConcurrent: 2 });
const request = text => normalize({ model: 'entire-codex', messages: [{ role: 'user', content: text || 'hello' }], max_tokens: 32 }, 'chat');
const usage = [{ model: 'test', input_tokens: 5, output_tokens: 7, cache_read_tokens: 2, cache_creation_tokens: 3 }];
const completed = (text = '你好🙂') => ({ id: 'run1', status: 'succeeded', review_changes_result: { summary: JSON.stringify({ entire2api: 1, response: text }) }, usage_by_model: usage });

async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'entire2api-test-'));
  t.after(async () => {
    const absolute = resolve(root);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep + 'entire2api-test-'));
    await rm(absolute, { recursive: true });
  });
  return new ReceiptStore(root);
}

function fakeEntire({ failStart = false, pending = false, loseRunReplies = 0 } = {}) {
  const agents = new Map(), runs = new Map(), dedup = new Map(), calls = [];
  let lost = 0;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname.replace('/api/v1', '');
    const body = options.body && JSON.parse(options.body);
    const method = options.method;
    calls.push({ path, method, headers: options.headers, body });
    assert.equal(options.redirect, 'error');
    const ok = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    if (path === '/et/test/agents' && method === 'POST') {
      const key = options.headers['Idempotency-Key'];
      if (dedup.has(key)) return ok(dedup.get(key));
      assert.deepEqual(body.triggers, []); assert.equal(body.is_enabled, false);
      const a = { id: `agent${agents.size + 1}`, etag: 'etag1', archived_at: null };
      agents.set(a.id, a); dedup.set(key, a); return ok(a);
    }
    const start = /^\/et\/test\/agents\/(agent\d+)\/runs$/.exec(path);
    if (start && method === 'POST') {
      if (failStart) return new Response('{}', { status: 403 });
      const key = options.headers['Idempotency-Key'];
      if (!dedup.has(key)) {
        const run = { ...completed(), id: `run${runs.size + 1}`, status: pending ? 'running' : 'succeeded' };
        runs.set(run.id, run); dedup.set(key, run);
      }
      if (lost++ < loseRunReplies) throw new Error('Connection lost after admission');
      return ok(dedup.get(key));
    }
    const cancel = /^\/et\/test\/runs\/(run\d+)\/cancel$/.exec(path);
    if (cancel) { const run = runs.get(cancel[1]); run.status = 'canceled'; return ok(run); }
    const getRun = /^\/et\/test\/runs\/(run\d+)$/.exec(path);
    if (getRun) return ok(runs.get(getRun[1]));
    const archive = /^\/et\/test\/agents\/(agent\d+)\/archive$/.exec(path);
    if (archive) {
      assert.equal(options.headers['If-Match'], 'etag1');
      const a = agents.get(archive[1]); a.archived_at = new Date().toISOString(); return ok(a);
    }
    const getAgent = /^\/et\/test\/agents\/(agent\d+)$/.exec(path);
    if (getAgent) return ok(agents.get(getAgent[1]));
    throw new Error(`Unexpected test route ${method} ${path}`);
  };
  return { client: new EntireClient({ getToken: async () => 'test-secret', fetchImpl, retryDelayMs: 1 }), agents, runs, calls };
}

test('text normalization preserves system roles, Unicode and multi-turn history', () => {
  const r = normalize({ model: 'm', messages: [{ role: 'system', content: '规则' }, { role: 'user', content: [{ type: 'text', text: '你好🙂' }] }, { role: 'assistant', content: 'hi' }, { role: 'user', content: 'again' }] }, 'chat');
  assert.equal(r.messages[1].content, '你好🙂'); assert.equal(r.messages.length, 4);
  assert.match(instructions(r), /Conversation JSON/);
});

test('Anthropic and Responses text inputs normalize to the same conversation', () => {
  const a = normalize({ model: 'm', system: 'policy', messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 }, 'anthropic');
  const b = normalize({ model: 'm', instructions: 'policy', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }], max_output_tokens: 32, store: false }, 'responses');
  assert.deepEqual(a.messages, b.messages);
});

test('unsupported controls, images, tools and malformed fields fail before admission', () => {
  for (const extra of [{ temperature: 0.5 }, { stop: ['x'] }, { tools: [{ name: 'bash' }] }, { stream: 'yes' }, { n: 2 }, { max_tokens: -1 }, { stream_options: [] }]) assert.throws(() => normalize({ model: 'm', messages: [{ role: 'user', content: 'x' }], ...extra }, 'chat'));
  assert.throws(() => normalize({ model: 'm', messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }], max_tokens: 4 }, 'anthropic'));
  assert.throws(() => instructions(request('x'.repeat(16384))), e => e.status === 413);
});

test('raw review text, incomplete results and unknown usage cannot leak as an answer', () => {
  assert.equal(extractAnswer(completed()).text, '你好🙂');
  assert.throws(() => extractAnswer({ ...completed(), status: 'failed' }), e => e.code === 'upstream_run_failed');
  assert.throws(() => extractAnswer({ ...completed(), review_changes_result: { summary: 'private repository review text' } }), e => e.code === 'invalid_answer_envelope' && !e.message.includes('private repository'));
  assert.throws(() => extractAnswer({ ...completed(), usage_by_model: null }), e => e.code === 'missing_usage');
});

test('credential destinations reject impersonating hosts, redirects and URL credentials', () => {
  for (const url of ['http://test.entire.io', 'https://entire.io.evil.test', 'https://user:pass@test.entire.io', 'https://entire.io/?secret=x']) assert.throws(() => trustedUrl(url));
  assert.equal(trustedUrl('https://eu.api.entire.io/api/v1').hostname, 'eu.api.entire.io');
});

test('Core project apiUrl is respected without falling back to another cell', async () => {
  const paths = [];
  const client = { request: async (base, path) => {
    paths.push([base, path]);
    if (path.startsWith('/projects/resolve')) return { project: { apiUrl: 'https://eu.api.entire.io' } };
    return { repository_id: '1'.repeat(26), environment: { id: '2'.repeat(26) }, target: { trail_id: '3'.repeat(26), change_id: '4'.repeat(26), head_sha: 'a'.repeat(40) } };
  } };
  assert.equal((await configureFromRun(client, 'et', 'test', 'run')).apiBase, 'https://eu.api.entire.io/api/v1');
  assert.equal(paths[1][0], 'https://eu.api.entire.io/api/v1');
  await assert.rejects(configureFromRun({ request: async () => ({ project: {} }) }, 'et', 'test', 'run'), e => e.code === 'missing_project_api');
});

test('paid jobs are deduplicated concurrently and after a gateway restart', async t => {
  const fake = fakeEntire(), receipts = await store(t);
  const a = new ReviewAdapter(config(), fake.client, receipts);
  const [r1, r2] = await Promise.all([a.generate(request(), { idempotencyKey: 'stable' }), a.generate(request(), { idempotencyKey: 'stable' })]);
  assert.equal(r1.runId, r2.runId); assert.equal(fake.runs.size, 1);
  assert.ok([...fake.agents.values()].every(a => a.archived_at));
  const restarted = new ReviewAdapter(config(), fake.client, receipts);
  assert.equal((await restarted.generate(request(), { idempotencyKey: 'stable' })).runId, r1.runId);
  assert.equal(fake.runs.size, 1);
  await assert.rejects(restarted.generate(request('different'), { idempotencyKey: 'stable' }), e => e.status === 409);
  const changedOperations = { ...config(), pollMs: 50, maxConcurrent: 1, models: { ...config().models, another: { harness: 'codex', model: null } } };
  assert.equal((await new ReviewAdapter(changedOperations, fake.client, receipts).generate(request(), { idempotencyKey: 'stable' })).runId, r1.runId);
  assert.equal(fake.runs.size, 1);
});

test('lost run admission replies recover the original paid job with the same key', async t => {
  const fake = fakeEntire({ loseRunReplies: 3 }), receipts = await store(t);
  await assert.rejects(new ReviewAdapter(config(), fake.client, receipts).generate(request(), { idempotencyKey: 'lost' }));
  assert.equal(fake.runs.size, 1); assert.equal([...fake.agents.values()][0].archived_at, null);
  const result = await new ReviewAdapter(config(), fake.client, receipts).generate(request(), { idempotencyKey: 'lost' });
  assert.equal(result.runId, 'run1'); assert.equal(fake.runs.size, 1);
  const starts = fake.calls.filter(c => c.path.endsWith('/runs') && c.method === 'POST');
  assert.equal(new Set(starts.map(c => c.headers['Idempotency-Key'])).size, 1);
});

test('explicit run rejection archives the temporary agent and does not create retries', async t => {
  const fake = fakeEntire({ failStart: true }), receipts = await store(t), a = new ReviewAdapter(config(), fake.client, receipts);
  await assert.rejects(a.generate(request(), { idempotencyKey: 'billing' }), e => e.code === 'entire_http_403');
  assert.ok([...fake.agents.values()][0].archived_at);
  await assert.rejects(a.generate(request(), { idempotencyKey: 'billing' }));
  assert.equal(fake.calls.filter(c => c.path.endsWith('/runs') && c.method === 'POST').length, 1);
});

test('disconnect cancellation reaches the upstream run and archives the temporary agent', async t => {
  const fake = fakeEntire({ pending: true }), receipts = await store(t), a = new ReviewAdapter(config(), fake.client, receipts), controller = new AbortController();
  const task = a.generate(request(), { idempotencyKey: 'cancel', signal: controller.signal });
  const assertion = assert.rejects(task, e => e.status === 504);
  while (!fake.runs.size) await new Promise(r => setTimeout(r, 2));
  controller.abort(); await assertion;
  assert.equal(fake.runs.get('run1').status, 'canceled');
  assert.ok([...fake.agents.values()][0].archived_at);
});

test('all three HTTP surfaces return matching text and valid terminal SSE events', async t => {
  const fake = fakeEntire(), receipts = await store(t), c = config();
  const server = createGateway({ adapter: new ReviewAdapter(c, fake.client, receipts), apiKey: 'test-gateway-key-1234', models: c.models });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.shutdown());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer test-gateway-key-1234', 'Content-Type': 'application/json', 'Idempotency-Key': 'cross-protocol' };
  const cases = [
    ['/v1/chat/completions', { model: 'entire-codex', messages: [{ role: 'user', content: 'hello' }], max_tokens: 32, stream_options: { include_usage: true } }, v => v.choices[0].message.content, '[DONE]'],
    ['/v1/messages', { model: 'entire-codex', messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 }, v => v.content[0].text, 'message_stop'],
    ['/v1/responses', { model: 'entire-codex', input: 'hello', max_output_tokens: 32 }, v => v.output[0].content[0].text, 'response.completed']
  ];
  for (const [path, body, getText, terminal] of cases) {
    let r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(r.status, 200); assert.equal(getText(await r.json()), '你好🙂');
    assert.equal(r.headers.get('x-entire2api-streaming'), 'buffered');
    r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
    const wire = await r.text();
    assert.match(wire, /你好🙂/); assert.ok(wire.includes(terminal));
    const events = wire.split('\n\n').filter(s => s.includes('data: ')).map(s => s.split('\n').find(x => x.startsWith('data: ')).slice(6));
    for (const value of events) if (value !== '[DONE]') assert.doesNotThrow(() => JSON.parse(value));
  }
  assert.equal(fake.runs.size, 1);
  const denied = await fetch(base + '/v1/models'); assert.equal(denied.status, 401); await denied.text();
  const bad = await fetch(base + '/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model: 'entire-codex', messages: [], max_tokens: 1 }) });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).type, 'error');
});

test('SSE failure ends with an error and no fabricated successful completion', async t => {
  const server = createGateway({ apiKey: 'test-gateway-key-1234', models: config().models, adapter: { generate: async () => { throw new GatewayError(502, 'upstream_run_failed', 'Job failed.'); } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.shutdown());
  const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/messages`, { method: 'POST', headers: { 'x-api-key': 'test-gateway-key-1234', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'entire-codex', messages: [{ role: 'user', content: 'hello' }], max_tokens: 32, stream: true }) });
  const wire = await r.text(); assert.match(wire, /event: error/); assert.doesNotMatch(wire, /message_stop/);
});

test('Responses event IDs and sequencing remain consistent', () => {
  const events = finalEvents('responses', request(), extractAnswer(completed()), 'resp_test', 0);
  assert.deepEqual(events.map(x => x[1].sequence_number), events.map((_, i) => i));
  assert.equal(events.at(-1)[1].response.id, 'resp_test');
  assert.equal(events.at(-1)[1].response.output[0].id, events[2][1].item.id);
});

test('oversized Anthropic bodies explain adapter limits instead of triggering the generic 32MB message', async t => {
  let admissions = 0;
  const server = createGateway({ apiKey: 'test-gateway-key-1234', models: config().models, adapter: { generate: async () => { admissions++; throw new Error('Unexpected admission'); } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.shutdown());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-api-key': 'test-gateway-key-1234', 'Content-Type': 'application/json' };
  const body = JSON.stringify({ model: 'entire-codex', max_tokens: 32, messages: [{ role: 'user', content: 'x'.repeat(140000) }] });
  const send = async (path, payload, chunked = false) => fetch(base + path, { method: 'POST', headers, body: chunked ? Readable.from([payload.slice(0, 70000), payload.slice(70000)]) : payload, ...(chunked ? { duplex: 'half' } : {}) });
  for (const chunked of [false, true]) {
    const r = await send('/v1/messages', body, chunked);
    assert.equal(r.status, 400);
    const value = await r.json();
    assert.equal(value.error.type, 'invalid_request_error');
    assert.match(value.error.message, /128 KiB/); assert.match(value.error.message, /full Claude Code sessions/);
  }
  const longPrompt = await send('/v1/messages', JSON.stringify({ model: 'entire-codex', max_tokens: 32, messages: [{ role: 'user', content: 'x'.repeat(17000) }] }));
  assert.equal(longPrompt.status, 400); assert.match((await longPrompt.json()).error.message, /16,384/);
  const chat = await send('/v1/chat/completions', body);
  assert.equal(chat.status, 413); assert.equal((await chat.json()).error.code, 'request_too_large');
  const tools = await send('/v1/messages', JSON.stringify({ model: 'entire-codex', max_tokens: 32, metadata: { user_id: 'test' }, tools: [{ name: 'Read', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: 'hello' }] }));
  assert.equal(tools.status, 400); assert.match((await tools.json()).error.message, /tool calling/);
  assert.equal(admissions, 0);
});
