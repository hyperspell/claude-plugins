# Hyperspell Activity

Logs what each Claude session did into your Hyperspell company brain as one
reviewable activity entry, so the team can find what people's agents worked on,
what they decided, and what is next, without anyone writing it up.

## What it does

After a turn in which Claude did real work (used a tool, or gave a substantial
answer), the plugin waits a second, then asks the session's own model for a short
structured summary of the session so far: a title, a summary, the decisions made,
the next steps, the links involved, and the workstream it belongs to. Trivial
turns are skipped. It then writes that summary through the Hyperspell connector's
`log_activity` tool as one entry per session, revised in place as the session goes
on, rather than a new entry each turn.

## What this plugin runs, reads and sends

The plugin is one hook module, `hooks/activity.ts`, with no commands, agents,
skills or MCP servers of its own. It runs no shell commands, starts no processes,
reads and writes no files, and makes no network requests of its own. Everything it
does goes through Claude Code's plugin interface, as follows.

### Hooks and what each one does

- **`session.start`**: registers the `/hyperspell-activity` command and reads one
  environment variable, `CLAUDE_CODE_ENTRYPOINT`, to label entries as coming from
  Claude Code or from Cowork. Nothing is sent.
- **`tool.call`**: observes only. It reads the call's `agentId`, to ignore calls
  made by subagents, records a single yes/no, "this turn used a tool", and passes
  every call through unchanged. It never reads, stores, rewrites, blocks or copies a
  tool's name, inputs or outputs, and it never runs a tool.
- **`turn.complete`**: after a turn of the main conversation that ended with an
  answer, it checks whether that turn used a tool or produced an answer of 400 or
  more characters. If so, it schedules one capture one second later (a run of quick
  turns costs one capture). It reads the turn's `agentId` (to ignore subagent
  turns), its end reason and the answer's length, and nothing else from the turn.
- **`session.end`**: resets the plugin's per-session state. Nothing is sent.
- **`command.run`** for `/hyperspell-activity`: answers `status`, `pause`, `resume`
  and `now` (see Controls). `now` runs a capture at once.

### The two calls a capture makes

1. **A model request over the session's own transcript** (`$.model.fork`). The
   plugin asks the model the session already uses, under the session's own account,
   to reply with one JSON object: `skip`, `title`, `summary`, `decisions`,
   `next_steps`, `links`, `workstream`. The prompt is fixed text in the module; it
   tells the model never to include secrets. The plugin does not copy or send the
   transcript anywhere; it only receives the reply.
2. **One MCP tool call** (`$.mcp.call`) to the tool `log_activity` on an MCP
   server that is already connected in the session. To find it, the plugin lists
   the session's tools once and picks, in order: the hosted Hyperspell connector,
   the `hyperspell-context` server the Hyperspell sync daemon registers, another
   connected server named for Hyperspell, or, failing all of those, any connected
   server that offers a `log_activity` tool. It calls no tool other than
   `log_activity`, and only on the server it picked. The first call asks the
   session's tool permission once; if the session refuses, capture pauses instead of
   asking again. Normally one call per capture: if the server answers that it cannot
   revise an entry (an older Hyperspell adapter), the same payload is sent once more
   without `entry_id`, and captures on that server then create one entry each.

What that call sends, and nothing else: `title`, `summary`, `decisions`,
`next_steps`, `links`, `workstream` (all from the model's reply, after redaction,
see below), `agent` (`claude-code` or `claude-cowork`), `share` (the setting
below), and, except in the fallback above, `entry_id` (`claude-session-` plus the
session id), so later captures revise the same entry. Where it goes is wherever
the chosen server sends it: for the Hyperspell connector, Hyperspell's API for your
workspace, under the connector's own credential and permissions. The connector's
privacy policy is at https://hyperspell.com/privacy.

Before anything is sent, text shaped like a credential is blanked to
`[redacted]`: private keys, API keys, bearer tokens and JWTs, `key=` / `secret=` /
`token=` / `password=` assignments, logins inside URLs, and long opaque tokens.
Links are kept only when they are `http(s)` URLs or paths relative to a project;
local absolute paths are dropped.

### Other interface use

The clock (`$.clock`) for the one-second settle timer and to read the time of
each successful capture, shown by `status`; toasts (`$.ui.toast`) to announce the
first capture, any pause, and the fallback from `shared` to `suggest` when the
workspace refuses direct sharing; the session id (`$.session.id`) for the entry
id; and the tool listing (`$.tool.list`) to find the server. That is the complete
list.

## Who sees an entry

The `share` option in the plugin's settings decides, and defaults to the most
private choice that still reaches the team:

- `suggest` (default): the entry stays yours, and your Hyperspell Inbox asks
  whether to share it with the company.
- `shared`: shared with the company at once, where your workspace allows direct
  sharing; otherwise it falls back to `suggest`.
- `personal`: never asks, never shares.

With a workspace (user-less) credential every entry is the company's; `personal`
is refused there and the plugin pauses rather than write.

## Controls

Inside a session: `/hyperspell-activity status` (on or paused, entries written,
the server used, the last problem), `pause`, `resume`, and `now` (write the entry
at once). Removing the plugin stops capture entirely.

## Requirements

The Hyperspell connector connected in your Claude account or organization, on a
Hyperspell server that offers `log_activity`. Without one the plugin writes
nothing and says so in `/hyperspell-activity status`.

Support: support@hyperspell.com
