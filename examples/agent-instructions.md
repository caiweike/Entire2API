# Optional Entire delegation preference

Copy these preferences into your Agent's supported project rules or system prompt
after the MCP server has been installed and authorized:

- For self-contained short text questions, explanations and analyses, prefer the
  `entire_ask` tool from the `entire2api` MCP server without requiring a fixed user prefix.
- The primary Agent reads files, edits code, runs commands and verifies results.
  Send Entire only a concise question and the minimum shareable context; never send
  secrets, full transcripts, system prompts or tool definitions.
- Skip Entire for greetings, status checks and local setup questions. Respect an
  explicit user request not to use it. New calls consume Entire review credits.
- Use one job per logical question. Reuse `request_id` only for identical retries,
  with the same question, model and budget. Keep questions below 12,000 characters;
  the encoded upstream instructions limit may require a shorter question.
- Permission denials and classifier failures are host-side decisions: report them,
  do not bypass them or repeatedly retry. These instructions grant no permissions.
- Cite Entire's answer only after receiving the actual tool result. Identify any
  primary-model fallback as such; do not pretend a failed tool produced an answer.

Claude Code's fully qualified name is `mcp__entire2api__entire_ask`; other clients
may expose a different prefix. Default `max_tokens` is 512, maximum 2048, advisory.
