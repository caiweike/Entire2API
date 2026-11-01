import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mcpRegistration, registrationOptions, doctor } from '../src/setup.mjs';
import { projectRoot } from '../src/mcp-tool.mjs';

const exec = promisify(execFile);

test('registration scopes and target project are explicit without parent-directory assumptions', () => {
  const cwd = resolve(tmpdir(), 'chosen-project');
  assert.deepEqual(registrationOptions([], cwd), { scope: 'local', projectDir: cwd });
  assert.equal(registrationOptions(['--scope', 'user'], cwd).scope, 'user');
  assert.equal(registrationOptions(['--project-dir', 'child'], cwd).projectDir, resolve(cwd, 'child'));
  for (const args of [['--scope', 'everything'], ['--scope'], ['--unknown', 'x']]) assert.throws(() => registrationOptions(args, cwd));
  const config = mcpRegistration({ root: cwd, node: 'my-node' });
  assert.deepEqual(config.args, [resolve(cwd, 'bin/entire2api.mjs'), 'mcp']);
  assert.equal(config.command, 'my-node');
  assert.equal(JSON.stringify(config).includes('gateway-key'), false);
});

test('portable CLI generates usable absolute MCP paths from an unrelated working directory', async () => {
  const { stdout, stderr } = await exec(process.execPath, [resolve(projectRoot, 'bin/entire2api.mjs'), 'mcp-config'], { cwd: tmpdir(), windowsHide: true });
  const config = JSON.parse(stdout).mcpServers.entire2api;
  assert.deepEqual(config, mcpRegistration());
  assert.equal(stderr, '');
});

test('setup diagnostic does not submit jobs or expose errors from a misconfigured local service', async () => {
  const secret = 'server-error-that-must-not-be-reflected';
  const result = await doctor({ env: { ENTIRE2API_CONFIG: resolve(tmpdir(), 'nonexistent-entire2api-config.json'), ENTIRE2API_KEY_FILE: resolve(tmpdir(), 'nonexistent-entire2api-key.txt') }, fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/v1/models')); assert.equal(options.method, undefined);
    throw new Error(secret);
  } });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.checks.find(c => c.check === 'gateway').ok, false);
});
