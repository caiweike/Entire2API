import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { GatewayError } from './errors.mjs';
import { instructions, extractAnswer } from './protocols.mjs';
import { projectPath } from './entire.mjs';

const terminal = new Set(['succeeded', 'failed', 'timed_out', 'canceled']);
const hash = value => createHash('sha256').update(value).digest('hex');

export class ReviewAdapter {
  constructor(config, client, store, { onWarning = () => {} } = {}) {
    this.config = config; this.client = client; this.store = store;
    this.pending = new Map(); this.active = 0; this.onWarning = onWarning;
  }

  async generate(request, { idempotencyKey, signal } = {}) {
    const model = this.config.models[request.model];
    if (!model) throw new GatewayError(404, 'model_not_found', 'Unknown model alias. Query /v1/models.');
    const prompt = instructions(request);
    // Include the pinned target and mapping in the fingerprint. Stream mode does
    // not change generation, so the same receipt can serve either wire format.
    const target = Object.fromEntries(['forge', 'project', 'apiBase', 'repositoryId', 'environmentId', 'trailId', 'changeId', 'headSha'].map(k => [k, this.config[k]]));
    const requestHash = hash(JSON.stringify({ messages: request.messages, maxTokens: request.maxTokens, model, target }));
    const legacyHash = hash(JSON.stringify({ messages: request.messages, maxTokens: request.maxTokens, model, target: this.config }));
    const key = hash(idempotencyKey || randomUUID());
    const existing = this.pending.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new GatewayError(409, 'idempotency_conflict', 'Idempotency-Key was already used with different input.');
      return existing.promise;
    }
    const entry = { requestHash };
    entry.promise = this.run(key, requestHash, prompt, model, signal, legacyHash);
    this.pending.set(key, entry);
    try { return await entry.promise; } finally { this.pending.delete(key); }
  }

  async run(key, requestHash, prompt, model, externalSignal, legacyHash) {
    let receipt = await this.store.load(key);
    if (receipt?.requestHash === legacyHash && legacyHash !== requestHash) {
      receipt.requestHash = requestHash;
      await this.store.save(key, receipt);
    }
    if (receipt && receipt.requestHash !== requestHash) throw new GatewayError(409, 'idempotency_conflict', 'Idempotency-Key was already used with different input.');
    if (receipt?.result) { await this.cleanup(receipt, key); return receipt.result; }
    if (receipt?.failure) { await this.cleanup(receipt, key); throw new GatewayError(receipt.failure.status, receipt.failure.code, receipt.failure.message); }
    if (this.active >= (this.config.maxConcurrent ?? 2)) throw new GatewayError(429, 'concurrency_limit', 'The gateway has reached its concurrent job limit.');
    this.active++;
    const signal = externalSignal ? AbortSignal.any([externalSignal, AbortSignal.timeout(this.config.runTimeoutMs)]) : AbortSignal.timeout(this.config.runTimeoutMs);
    const prefix = projectPath(this.config);
    receipt ||= { requestHash, jobId: randomUUID(), createdAt: new Date().toISOString() };
    let finished = false;
    try {
      await this.store.save(key, receipt);
      if (!receipt.agentId) {
        const agent = await this.client.request(this.config.apiBase, `${prefix}/agents`, { method: 'POST', signal,
          headers: { 'Idempotency-Key': `${receipt.jobId}-agent` }, body: {
            name: `Entire2API ${receipt.jobId}`, description: 'Ephemeral text gateway request; manual runs only.',
            environment_id: this.config.environmentId, repository_ids: [this.config.repositoryId],
            harness: model.harness, model: model.model ?? null, ...(model.reasoning_effort ? { reasoning_effort: model.reasoning_effort } : {}),
            instructions: prompt, signal: { value_type: 'boolean', polarity: 'neutral' },
            timeout_ms: this.config.runTimeoutMs, is_enabled: false, triggers: []
          }
        });
        if (!agent.id || !agent.etag) throw new GatewayError(502, 'invalid_agent_response', 'Entire did not return an Agent ID and write token.');
        receipt.agentId = agent.id; receipt.etag = agent.etag;
        await this.store.save(key, receipt);
      }
      let run;
      if (!receipt.runId) {
        run = await this.client.request(this.config.apiBase, `${prefix}/agents/${encodeURIComponent(receipt.agentId)}/runs`, { method: 'POST', signal,
          headers: { 'Idempotency-Key': `${receipt.jobId}-run` }, body: { target: { trail_id: this.config.trailId, change_id: this.config.changeId }, head_sha: this.config.headSha }
        });
        if (!run.id) throw new GatewayError(502, 'invalid_run_response', 'Entire did not return a run ID.');
        receipt.runId = run.id; await this.store.save(key, receipt);
      }
      while (!run || !terminal.has(run.status)) {
        if (run) await delay(this.config.pollMs, undefined, { signal });
        run = await this.client.request(this.config.apiBase, `${prefix}/runs/${encodeURIComponent(receipt.runId)}`, { signal });
      }
      finished = true;
      const result = extractAnswer(run);
      receipt.result = result;
      await this.store.save(key, receipt);
      return result;
    } catch (error) {
      const e = signal.aborted ? new GatewayError(504, 'run_timeout_or_cancelled', 'The Entire job was cancelled or exceeded its deadline.') : error;
      e.runId = receipt.runId;
      if (!receipt.runId && receipt.agentId && error.upstreamStatus >= 400 && error.upstreamStatus < 500 && error.upstreamStatus !== 429) finished = true;
      // A completed failed job is never recreated by a client retry. If a POST
      // response was lost, leave its idempotency receipt resumable instead.
      if (finished && e instanceof GatewayError) {
        receipt.failure = { status: e.status, code: e.code, message: e.message };
        await this.store.save(key, receipt);
      }
      throw e;
    } finally {
      try {
        if (!finished && receipt.runId) {
          const canceled = await this.client.request(this.config.apiBase, `${prefix}/runs/${encodeURIComponent(receipt.runId)}/cancel`, { method: 'POST', signal: AbortSignal.timeout(15000) });
          finished = terminal.has(canceled.status);
          if (finished && !receipt.result && !receipt.failure) {
            receipt.failure = { status: 504, code: 'run_cancelled', message: 'The original request was interrupted and its Entire job was cancelled. Use a new Idempotency-Key for a new job.' };
            await this.store.save(key, receipt);
          }
        }
        // If the run-create reply was lost, do not archive: retrying the same
        // idempotency key must be able to recover the original immutable run.
        if (finished || (receipt.agentId && !receipt.runId && receipt.failure)) await this.cleanup(receipt, key);
      } catch { this.onWarning({ code: 'cleanup_pending', receipt: key, runId: receipt.runId }); }
      this.active--;
    }
  }

  async cleanup(receipt, key) {
    if (!receipt.agentId || receipt.archived) return;
    const prefix = projectPath(this.config), path = `${prefix}/agents/${encodeURIComponent(receipt.agentId)}`;
    try {
      let agent = await this.client.request(this.config.apiBase, path, { signal: AbortSignal.timeout(15000) });
      if (!agent.archived_at) agent = await this.client.request(this.config.apiBase, `${path}/archive`, { method: 'POST', headers: { 'If-Match': agent.etag }, signal: AbortSignal.timeout(15000) });
      receipt.archived = Boolean(agent.archived_at);
      await this.store.save(key, receipt);
    } catch { this.onWarning({ code: 'cleanup_pending', receipt: key, runId: receipt.runId }); }
  }
}
