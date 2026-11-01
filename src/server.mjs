import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { GatewayError, errorBody, safeError } from './errors.mjs';
import { normalize, responseObject, finalEvents, responseId, instructions } from './protocols.mjs';

const routes = { '/v1/chat/completions': 'chat', '/v1/messages': 'anthropic', '/v1/responses': 'responses' };
const same = (a, b) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function readBody(req) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new GatewayError(415, 'unsupported_encoding', 'Send uncompressed JSON requests.');
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new GatewayError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  const tooLarge = () => {
    // Drain without retaining the rejected body, keeping the error response writable.
    req.resume();
    throw new GatewayError(413, 'request_too_large', 'Request body exceeds 128 KiB.');
  };
  if (Number(req.headers['content-length']) > 128 * 1024) tooLarge();
  let length = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 128 * 1024) tooLarge();
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GatewayError(400, 'invalid_json', 'The request body is not valid JSON.'); }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createGateway({ adapter, apiKey, models, requestsPerMinute = 60, onLog = () => {} }) {
  const controllers = new Set();
  let bucket = { minute: 0, count: 0 };
  const server = createServer(async (req, res) => {
    const requestId = `req_${randomUUID().replaceAll('-', '')}`;
    const path = req.url?.split('?')[0];
    const protocol = routes[path] || (req.headers['anthropic-version'] ? 'anthropic' : 'chat');
    const controller = new AbortController();
    controllers.add(controller);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    req.on('aborted', () => controller.abort());
    let heartbeat;
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-entire2api-mode', 'review-adapter');
    res.setHeader('x-entire2api-streaming', 'buffered');
    res.setHeader('x-entire2api-token-limit', 'advisory');
    res.setHeader('x-entire2api-usage', 'whole-job');
    const emit = async (event, data) => {
      if (controller.signal.aborted || res.destroyed) throw new GatewayError(499, 'client_disconnected', 'The client disconnected.');
      const wire = `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
      if (!res.write(wire)) await once(res, 'drain', { signal: controller.signal });
    };
    try {
      if (path === '/healthz' && req.method === 'GET') { json(res, 200, { status: 'ok', mode: 'review-adapter' }); return; }
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      const provided = bearer || (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '');
      if (!same(provided, apiKey)) throw new GatewayError(401, 'invalid_api_key', 'A valid gateway API key is required.');
      if (path === '/v1/models' && req.method === 'GET') {
        const ids = Object.keys(models);
        json(res, 200, protocol === 'anthropic' ? { data: ids.map(id => ({ id, type: 'model', display_name: id, created_at: '1970-01-01T00:00:00Z' })), has_more: false, first_id: ids[0], last_id: ids.at(-1) } : { object: 'list', data: ids.map(id => ({ id, object: 'model', created: 0, owned_by: 'entire-review-adapter' })) });
        return;
      }
      if (!routes[path]) throw new GatewayError(404, 'not_found', 'Unknown API endpoint.');
      if (req.method !== 'POST') throw new GatewayError(405, 'method_not_allowed', 'This endpoint accepts POST requests.');
      const minute = Math.floor(Date.now() / 60000);
      if (bucket.minute !== minute) bucket = { minute, count: 0 };
      if (++bucket.count > requestsPerMinute) { res.setHeader('Retry-After', '60'); throw new GatewayError(429, 'rate_limit', 'Gateway request rate limit exceeded.'); }
      const request = normalize(await readBody(req), protocol);
      if (!Object.hasOwn(models, request.model)) throw new GatewayError(404, 'model_not_found', 'Unknown model alias. Query /v1/models.');
      instructions(request); // Reject oversized prompts before opening SSE or creating jobs.
      const idempotencyKey = req.headers['idempotency-key'];
      if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))) throw new GatewayError(400, 'invalid_idempotency_key', 'Idempotency-Key must contain 1–128 visible ASCII characters.');
      const id = responseId(protocol), created = Math.floor(Date.now() / 1000);
      if (request.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        res.write(': Entire2API buffered review adapter; waiting for job completion\n\n');
        heartbeat = setInterval(() => { if (!res.destroyed && !res.writableNeedDrain) res.write(': waiting for Entire job\n\n'); }, 15000);
        heartbeat.unref();
      }
      const result = await adapter.generate(request, { idempotencyKey, signal: controller.signal });
      if (res.destroyed) return;
      if (!request.stream) { res.setHeader('x-entire-run-id', result.runId); json(res, 200, responseObject(protocol, request, result, id, created)); }
      else { for (const [event, data] of finalEvents(protocol, request, result, id, created)) await emit(event, data); res.end(); }
      onLog({ requestId, protocol, status: 200, runId: result.runId });
    } catch (error) {
      let e = safeError(error);
      // Claude Code replaces 413 with its generic "max 32MB / attachments"
      // message. Report the smaller adapter budget as an explicit capability error.
      if (protocol === 'anthropic' && e.status === 413) {
        const source = e;
        e = new GatewayError(400, source.code, `${source.message} Entire2API is a short-text review adapter (16,384 characters including its wrapper); full Claude Code sessions and client tools are unsupported.`);
        e.runId = source.runId;
      }
      if (!res.destroyed) {
        if (!res.headersSent) { if (e.runId) res.setHeader('x-entire-run-id', e.runId); json(res, e.status, errorBody(e, protocol, requestId)); }
        else {
          try {
            if (protocol === 'responses') await emit('error', { type: 'error', code: e.code, message: e.message, param: null, sequence_number: 0 });
            else await emit(protocol === 'anthropic' ? 'error' : null, errorBody(e, protocol, requestId));
          } catch {}
          res.end();
        }
      }
      onLog({ requestId, protocol, status: e.status, code: e.code, runId: e.runId });
    } finally { clearInterval(heartbeat); controllers.delete(controller); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 64;
  server.shutdown = () => { for (const c of controllers) c.abort(); server.close(); server.closeIdleConnections(); };
  return server;
}
