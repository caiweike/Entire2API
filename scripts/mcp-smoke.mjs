import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { projectRoot } from '../src/mcp-tool.mjs';

const client = new Client({ name: 'entire2api-live-smoke', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(projectRoot, 'bin/entire2api.mjs'), 'mcp'], cwd: projectRoot, stderr: 'inherit' }));
  assert.deepEqual((await client.listTools()).tools.map(x => x.name), ['entire_ask']);
  // Explicitly opt into reusing a prior receipt; a fresh smoke starts one job.
  const result = await client.callTool({ name: 'entire_ask', arguments: { question: 'Reply with exactly ENTIRE2API_OK.', max_tokens: 32, request_id: process.env.SMOKE_IDEMPOTENCY_KEY || `mcp-smoke-${randomUUID()}` } }, { timeout: 300000 });
  assert.ok(!result.isError, result.content?.[0]?.text);
  assert.equal(result.structuredContent.answer, 'ENTIRE2API_OK');
  const evidence = { checked_at: new Date().toISOString(), transport: 'stdio', tool: 'entire_ask', ...result.structuredContent };
  await mkdir(resolve(projectRoot, '.local/evidence'), { recursive: true });
  await writeFile(resolve(projectRoot, '.local/evidence/mcp-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await client.close(); }
