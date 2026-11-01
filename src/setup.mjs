import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectRoot, mcpOptions } from './mcp-tool.mjs';
import { loadConfig } from './config.mjs';

const exec = promisify(execFile);

export function mcpRegistration({ node = process.execPath, root = projectRoot } = {}) {
  return { type: 'stdio', command: node, args: [resolve(root, 'bin/entire2api.mjs'), 'mcp'], timeout: 300000 };
}

export function registrationOptions(args, cwd = process.cwd()) {
  const result = { scope: 'local', projectDir: resolve(cwd) };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === '--scope' && ['local', 'project', 'user'].includes(value)) result.scope = value;
    else if (flag === '--project-dir') result.projectDir = resolve(cwd, value);
    else throw new Error('Use --scope local|project|user and/or --project-dir PATH.');
  }
  return result;
}

export async function registerMcp(args, cwd = process.cwd()) {
  const options = registrationOptions(args, cwd);
  const config = mcpRegistration();
  await mkdir(resolve(projectRoot, '.local'), { recursive: true });
  await writeFile(resolve(projectRoot, '.local/mcp-server.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const { stdout } = await exec(process.platform === 'win32' ? 'claude.exe' : 'claude', ['mcp', 'add-json', '--scope', options.scope, 'entire2api', JSON.stringify(config)], { cwd: options.projectDir, windowsHide: true });
  return { message: stdout.trim(), ...options };
}

export async function doctor({ env = process.env, fetchImpl = fetch } = {}) {
  const checks = [{ check: 'node', ok: Number(process.versions.node.split('.')[0]) >= 24, detail: process.version }];
  try { await loadConfig(env); checks.push({ check: 'configuration', ok: true }); }
  catch { checks.push({ check: 'configuration', ok: false, detail: 'Run configure with your own project and existing run ID.' }); }
  const options = mcpOptions(env);
  let key;
  try {
    key = (await readFile(options.keyFile, 'utf8')).trim();
    checks.push({ check: 'gateway-key', ok: key.length >= 16 && !/\s/.test(key) });
  } catch { checks.push({ check: 'gateway-key', ok: false, detail: 'No local key file; complete configure first.' }); }
  try {
    const r = await fetchImpl(options.baseUrl + '/v1/models', { headers: key ? { Authorization: 'Bearer ' + key } : {}, signal: AbortSignal.timeout(3000), redirect: 'error' });
    const value = await r.json();
    checks.push({ check: 'gateway', ok: r.ok && Array.isArray(value.data) && value.data.some(x => x.id === options.model), detail: r.ok ? 'Configured model alias available; no paid job submitted.' : `HTTP ${r.status}` });
  } catch { checks.push({ check: 'gateway', ok: false, detail: 'Start the gateway with node bin/entire2api.mjs start.' }); }
  return { ok: checks.every(x => x.ok), checks };
}
