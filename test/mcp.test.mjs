import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createAskTool, localGatewayUrl, mcpOptions, projectRoot } from '../src/mcp-tool.mjs';

const key = 'test-only-local-key-123456';
const options = { baseUrl: 'http://127.0.0.1:8080', readKey: async () => key };
const reply = (answer = '你好') => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { headers: { 'x-entire-run-id': 'test-run' } });

test('MCP forwards only explicit short question and returns run metadata', async () => {
  const updates = [];
  const ask = createAskTool({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url, options.baseUrl + '/v1/chat/completions');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + key);
    assert.equal(init.headers['Idempotency-Key'], 'retry-1');
    assert.deepEqual(JSON.parse(init.body), { model: 'entire-codex', messages: [{ role: 'user', content: '你好' }], max_tokens: 32 });
    return reply();
  } });
  const result = await ask({ question: '你好', max_tokens: 32, request_id: 'retry-1' }, { notifyProgress: async p => updates.push(p) });
  assert.deepEqual(result.structuredContent, { answer: '你好', model: 'entire-codex', run_id: 'test-run', request_id: 'retry-1' });
  assert.equal(updates.length, 2);
  assert.equal(mcpOptions({}).keyFile, resolve(projectRoot, '.local/gateway-key.txt'));
});

test('MCP rejects invalid and encoded oversized inputs before reading credentials', async () => {
  const ask = createAskTool({ ...options, readKey: () => assert.fail('must not read key'), fetchImpl: () => assert.fail('must not submit') });
  for (const args of [{ question: ' ' }, { question: 'x'.repeat(12001) }, { question: '\\'.repeat(11000) }, { question: 'ok', tools: [] }, { question: 'ok', max_tokens: 3000 }, { question: 'ok', request_id: '\n' }]) {
    assert.equal((await ask(args)).isError, true);
  }
  for (const url of ['https://example.com', 'http://localhost/v1', 'http://a:b@localhost', 'http://localhost/?key=x']) assert.throws(() => localGatewayUrl(url));
});

test('MCP bounds responses and never reflects credentials in upstream errors', async () => {
  for (const fetchImpl of [async () => { throw new Error(key); }, async () => new Response(JSON.stringify({ error: { message: key } }), { status: 401 }), async () => reply(key), async () => new Response('x'.repeat(512 * 1024 + 1))]) {
    const result = await createAskTool({ ...options, fetchImpl })({ question: 'hello' });
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test('MCP passes cancellation to its HTTP request', async () => {
  const controller = new AbortController();
  const ask = createAskTool({ ...options, fetchImpl: async (_url, init) => {
    controller.abort();
    assert.equal(init.signal.aborted, true);
    throw init.signal.reason;
  } });
  const result = await ask({ question: 'hello' }, { signal: controller.signal });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /cancelled/);
});

test('official MCP client discovers and calls real stdio entry from another directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'entire2api-mcp-test-'));
  const keyFile = join(root, 'key.txt');
  await writeFile(keyFile, key);
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    assert.equal(req.headers.authorization, 'Bearer ' + key);
    res.writeHead(200, { 'Content-Type': 'application/json', 'x-entire-run-id': 'stdio-run' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'STDIO_OK 你好' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = new Client({ name: 'entire2api-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(projectRoot, 'bin/entire2api.mjs'), 'mcp'], cwd: root, stderr: 'pipe', env: { ENTIRE2API_URL: `http://127.0.0.1:${server.address().port}`, ENTIRE2API_KEY_FILE: keyFile } });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    await client.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'entire2api-mcp-test-'));
    await rm(root, { recursive: true });
  });
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(x => x.name), ['entire_ask']);
  const progress = [];
  const result = await client.callTool({ name: 'entire_ask', arguments: { question: '只转发这个问题', max_tokens: 32 } }, { onprogress: p => progress.push(p) });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.answer, 'STDIO_OK 你好');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[0].content, '只转发这个问题');
  assert.ok(progress.length >= 1);
  assert.equal(stderr, '');
  const rejected = await client.callTool({ name: 'entire_ask', arguments: { question: 'x', tools: [] } });
  assert.equal(rejected.isError, true);
  assert.equal(requests.length, 1);
});
