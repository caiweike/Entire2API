import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { instructions, normalize } from './protocols.mjs';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function localGatewayUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw new Error('MCP gateway URL must be a loopback origin without a path or credentials.');
  }
  return u.origin;
}

export function mcpOptions(env = process.env) {
  return {
    baseUrl: localGatewayUrl(env.ENTIRE2API_URL || 'http://127.0.0.1:8080'),
    keyFile: env.ENTIRE2API_KEY_FILE || resolve(projectRoot, '.local/gateway-key.txt'),
    model: env.ENTIRE2API_MODEL || 'entire-codex',
    timeoutMs: 300000
  };
}

const failure = message => ({ isError: true, content: [{ type: 'text', text: message }] });

export function createAskTool({ baseUrl, keyFile, model = 'entire-codex', timeoutMs = 300000, fetchImpl = fetch, readKey = () => readFile(keyFile, 'utf8'), progressMs = 15000 }) {
  const origin = localGatewayUrl(baseUrl);
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(model)) throw new Error('Invalid MCP model alias.');
  return async (args, { signal, notifyProgress = async () => {} } = {}) => {
    if (!args || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 12000 || Object.keys(args).some(k => !['question', 'max_tokens', 'request_id'].includes(k))) return failure('Supply question as nonempty text, at most 12,000 characters; no files or tool definitions.');
    const maxTokens = args.max_tokens ?? 512;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) return failure('max_tokens must be an integer from 1 to 2048; the upstream token budget is advisory.');
    if (args.request_id !== undefined && (typeof args.request_id !== 'string' || !/^[\x21-\x7e]{1,100}$/.test(args.request_id))) return failure('request_id must contain 1–100 visible ASCII characters.');
    const body = { model, messages: [{ role: 'user', content: args.question }], max_tokens: maxTokens };
    try { instructions(normalize(body, 'chat')); }
    catch { return failure('The encoded question exceeds the Entire instructions budget. Shorten or summarize it, especially repeated quotes and backslashes.'); }

    if (signal?.aborted) return failure('Entire question cancelled before submission.');
    let key;
    try { key = (await readKey()).trim(); }
    catch { return failure('The local gateway key file is unavailable. Complete Entire2API configuration first.'); }
    if (key.length < 16 || /\s/.test(key)) return failure('The local gateway key file is invalid.');
    const requestId = args.request_id || randomUUID();
    const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let progress = 0, notifying = false;
    const report = async message => {
      if (notifying || combinedSignal.aborted) return;
      notifying = true;
      try { await notifyProgress({ progress: progress++, message }); } catch {} finally { notifying = false; }
    };
    await report('Submitting a short question to the Entire review adapter.');
    const timer = setInterval(() => { void report('Waiting for the Entire review job; its answer is buffered until completion.'); }, progressMs);
    timer.unref();
    try {
      const response = await fetchImpl(origin + '/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: combinedSignal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify(body)
      });
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 512 * 1024) return failure('The local gateway response exceeded the MCP size limit.');
        chunks.push(chunk);
      }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return failure('The local gateway returned invalid JSON.'); }
      if (!response.ok) {
        // Do not reflect arbitrary response messages or process exceptions into
        // an agent: a misconfigured local service could echo credentials there.
        const code = typeof value.error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(value.error.code) ? value.error.code : 'gateway_error';
        const hint = response.status === 401 ? 'Check the gateway API key file.' : response.status === 409 ? 'This request_id was used with different input or model settings; use a new request_id for a new task.' : response.status === 429 ? 'The gateway is busy; retry this same request_id later.' : 'Check the Entire2API service and its run logs; do not send a full agent conversation.';
        return failure(`Entire2API rejected this question (HTTP ${response.status}, ${code}). ${hint} request_id=${requestId}`);
      }
      const answer = value.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || answer.length > 128 * 1024 || answer.includes(key)) return failure('The local gateway did not return a usable text answer.');
      const runId = response.headers.get('x-entire-run-id');
      await report('Entire answer received.');
      return {
        content: [{ type: 'text', text: answer }],
        structuredContent: { answer, model, run_id: runId, request_id: requestId },
        _meta: { entire2api: { mode: 'review-adapter', streaming: 'buffered', usage: 'whole-job' } }
      };
    } catch {
      return failure(combinedSignal.aborted ? `Entire question cancelled or timed out. The gateway will try to cancel its job. request_id=${requestId}` : `Could not reach the local Entire2API gateway. Start npm.cmd start in the Entire2API directory. request_id=${requestId}`);
    } finally { clearInterval(timer); }
  };
}
