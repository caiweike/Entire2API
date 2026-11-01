# Working on Entire2API

For installing this tool into another Agent, read [INSTALL.md](INSTALL.md).
For modifying the implementation, use Node.js 24+, run `npm ci --ignore-scripts`,
then `npm test`. The normal test suite uses mocks and incurs no Entire charges.

## Boundaries

- This is a repository review-job text adapter, not a complete inference API.
- Keep unsupported tools, attachments and generation controls explicitly rejected.
- Do not replace a user's primary Agent provider with this text-only adapter.
- Keep stdio MCP stdout protocol-only. Diagnostics go to stderr.
- Never commit `.local`, `.tools`, `.env`, credentials, logs or run receipts.
- Live smoke tests submit paid review jobs unless an existing receipt is reused.
- Do not change client permission rules, trust settings or primary models during
  installation. Explain host-side permission errors and let the user approve.

## Layout

- `bin/entire2api.mjs`: portable CLI, resolves installation paths itself.
- `src/adapter.mjs`, `entire.mjs`, `store.mjs`: upstream jobs, auth, deduplication.
- `src/protocols.mjs`, `server.mjs`: HTTP protocol subsets.
- `src/mcp-*.mjs`, `setup.mjs`: MCP tool and setup helpers.
- `test/`: gateway, MCP and portable installation tests.

Public docs and examples use placeholders, never a maintainer's local paths or
project/run identifiers. Do not include downloaded upstream asset snapshots.
