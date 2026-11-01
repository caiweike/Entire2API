import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { trustedUrl } from './entire.mjs';

export function validateConfig(c) {
  if (!c || !['et', 'gh'].includes(c.forge) || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(c.project)) throw new Error('Invalid forge/project configuration');
  trustedUrl(c.apiBase);
  for (const key of ['repositoryId', 'environmentId', 'trailId', 'changeId']) if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(c[key])) throw new Error(`Invalid ${key}`);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(c.headSha)) throw new Error('Invalid headSha');
  if (!c.models || Array.isArray(c.models) || Object.keys(c.models).length < 1 || Object.keys(c.models).length > 32) throw new Error('Configure between 1 and 32 model aliases');
  for (const [alias, model] of Object.entries(c.models)) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(alias) || !model || !['claude', 'codex'].includes(model.harness) || (model.model !== null && (typeof model.model !== 'string' || model.model.length > 128 || !model.model))) throw new Error('Invalid model mapping');
    if (model.reasoning_effort && !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(model.reasoning_effort)) throw new Error('Invalid reasoning effort');
  }
  for (const [key, min, max, fallback] of [['runTimeoutMs', 1000, 1800000, 180000], ['pollMs', 100, 10000, 2000], ['maxConcurrent', 1, 10, 2]]) {
    c[key] ??= fallback;
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`Invalid ${key}`);
  }
  return c;
}

export async function loadConfig(env = process.env) {
  const file = env.ENTIRE2API_CONFIG || resolve('.local/config.json');
  return validateConfig(JSON.parse(await readFile(file, 'utf8')));
}

export async function gatewayKey(env = process.env) {
  let key = env.GATEWAY_API_KEY;
  if (!key) {
    const file = env.GATEWAY_KEY_FILE || resolve('.local/gateway-key.txt');
    try { key = (await readFile(file, 'utf8')).trim(); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      key = randomBytes(32).toString('hex');
      await mkdir(dirname(file), { recursive: true });
      try { await writeFile(file, key, { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; key = (await readFile(file, 'utf8')).trim(); }
    }
  }
  if (key.length < 16 || /\s/.test(key)) throw new Error('Gateway API key must contain at least 16 non-whitespace characters');
  return key;
}
