import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createAskTool, mcpOptions } from './mcp-tool.mjs';

export function createEntireMcpServer(options = mcpOptions()) {
  const server = new McpServer({ name: 'entire2api', version: '0.2.0' });
  const ask = createAskTool(options);
  server.registerTool('entire_ask', {
    title: 'Ask Entire a short text question',
    description: 'Delegate a short, self-contained text question to the configured Entire review Agent. Only the question is sent, not your conversation or tool definitions. The question is stored in the configured Entire review repository’s Agent history; do not include secrets. This consumes Entire review credits and may take up to several minutes. Use for explanations, small analyses or a second opinion; it cannot read files or execute your tools. Reuse request_id only for retries of the same task; omitting it starts a fresh job.',
    inputSchema: z.object({
      question: z.string().min(1).max(12000).describe('Short, self-contained text question; include only the necessary context, never a full agent transcript.'),
      max_tokens: z.number().int().min(1).max(2048).optional().describe('Advisory output budget; defaults to 512.'),
      request_id: z.string().regex(/^[\x21-\x7e]{1,100}$/).optional().describe('Stable ID for retrying this exact task; use a new ID for a new task or changed model.')
    }).strict(),
    outputSchema: z.object({ answer: z.string(), model: z.string(), run_id: z.string().nullable(), request_id: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (args, ctx) => {
    const token = ctx.mcpReq._meta?.progressToken;
    return ask(args, {
      signal: ctx.mcpReq.signal,
      notifyProgress: token === undefined ? undefined : update => ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, ...update } })
    });
  });
  return server;
}
