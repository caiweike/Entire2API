import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { GatewayError } from './errors.mjs';

const exec = promisify(execFile);

export function trustedUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443') || !['entire.io', 'entire.com'].some(d => u.hostname === d || u.hostname.endsWith(`.${d}`))) {
    throw new GatewayError(500, 'untrusted_upstream', 'Upstream URLs must use HTTPS on an Entire host.');
  }
  return u;
}

export function credentialProvider(env = process.env) {
  let cached, until = 0, pending;
  return async () => {
    if (env.ENTIRE_TOKEN) return env.ENTIRE_TOKEN.trim();
    if (env.ENTIRE_TOKEN_FILE) return (await readFile(env.ENTIRE_TOKEN_FILE, 'utf8')).trim();
    if (cached && Date.now() < until) return cached;
    if (!pending) pending = (async () => {
      try {
        const { stdout } = await exec(env.ENTIRE_CLI || (process.platform === 'win32' && existsSync(resolve('.tools/entire.exe')) ? resolve('.tools/entire.exe') : 'entire'), ['auth', 'token'], {
          timeout: 20000, maxBuffer: 65536, windowsHide: true,
          env: { ...env, ENTIRE_CONFIG_DIR: env.ENTIRE_CONFIG_DIR || resolve('.local/entire') }
        });
        if (!stdout.trim() || /\s/.test(stdout.trim())) throw new Error('invalid token output');
        cached = stdout.trim(); until = Date.now() + 30000;
        return cached;
      } catch {
        throw new GatewayError(503, 'entire_login_required', 'Entire credentials are unavailable. Complete the official CLI login or configure ENTIRE_TOKEN_FILE.');
      } finally { pending = undefined; }
    })();
    return pending;
  };
}

async function readJson(response) {
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) throw new GatewayError(502, 'upstream_response_too_large', 'Entire response exceeded the gateway limit.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GatewayError(502, 'upstream_invalid_json', 'Entire returned an invalid JSON response.'); }
}

export class EntireClient {
  constructor({ getToken = credentialProvider(), fetchImpl = fetch, retryDelayMs = 500 } = {}) {
    this.getToken = getToken; this.fetchImpl = fetchImpl; this.retryDelayMs = retryDelayMs;
  }

  async request(base, path, { method = 'GET', body, headers = {}, signal } = {}) {
    const root = trustedUrl(base);
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected an absolute API path');
    const url = trustedUrl(root.href.replace(/\/$/, '') + path);
    const retryable = method === 'GET' || Boolean(headers['Idempotency-Key']);
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new GatewayError(504, 'request_cancelled', 'The request was cancelled or timed out.');
      let response;
      try {
        const token = await this.getToken();
        if (!token || /[\r\n]/.test(token)) throw new GatewayError(503, 'entire_login_required', 'A valid Entire credential is required.');
        response = await this.fetchImpl(url, {
          method, redirect: 'error',
          headers: { 'User-Agent': 'Entire2API/0.1', Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
        });
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (retryable && attempt < 2 && !signal?.aborted) { await delay(this.retryDelayMs * 2 ** attempt, undefined, { signal }); continue; }
        throw new GatewayError(signal?.aborted ? 504 : 502, 'entire_transport_error', 'The connection to Entire failed.');
      }
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();
        if (retryable && [429, 502, 503, 504].includes(status) && attempt < 2) {
          const seconds = Number(response.headers.get('retry-after'));
          await delay(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10000) : this.retryDelayMs * 2 ** attempt, undefined, { signal });
          continue;
        }
        const e = new GatewayError(status === 429 ? 429 : 502, `entire_http_${status}`, `Entire rejected the request (HTTP ${status}). Check the run, project permissions and billing in Entire.`);
        e.upstreamStatus = status;
        throw e;
      }
      return readJson(response);
    }
  }
}

export function projectPath(config) { return `/${encodeURIComponent(config.forge)}/${encodeURIComponent(config.project)}`; }

export async function configureFromRun(client, forge, project, runId, core = 'https://us.console.entire.io/api/v1') {
  const projectInfo = await client.request(core, `/projects/resolve/${encodeURIComponent(forge)}/${encodeURIComponent(project)}`);
  const apiUrl = projectInfo.project?.apiUrl;
  if (!apiUrl) throw new GatewayError(502, 'missing_project_api', 'Core did not return a project API URL.');
  const resolvedUrl = trustedUrl(apiUrl);
  const apiBase = resolvedUrl.pathname === '/' ? resolvedUrl.origin + '/api/v1' : resolvedUrl.href.replace(/\/$/, '');
  const run = await client.request(apiBase, `/${encodeURIComponent(forge)}/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}`);
  const config = { forge, project, apiBase, repositoryId: run.repository_id, environmentId: run.environment?.id, trailId: run.target?.trail_id, changeId: run.target?.change_id, headSha: run.target?.head_sha,
    models: { 'entire-codex': { harness: 'codex', model: null } }, runTimeoutMs: 180000, pollMs: 2000, maxConcurrent: 2 };
  for (const key of ['repositoryId', 'environmentId', 'trailId', 'changeId', 'headSha']) if (!config[key]) throw new GatewayError(502, 'incomplete_target', `The source run did not provide ${key}.`);
  return config;
}
