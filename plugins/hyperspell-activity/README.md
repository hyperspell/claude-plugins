# Hyperspell Activity

Logs what your Claude sessions did into your Hyperspell company brain as one
reviewable activity entry per piece of work (a repository and a branch), so the team can find what people's agents worked on,
what they decided, and what is next, without anyone writing it up.

This describes plugin 0.2.0. Connect Hyperspell, then install from the marketplace:

```
/plugin install hyperspell-activity --marketplace hyperspell/claude-plugins
```

Daemon users can instead run `hyperspell activity suggest` (daemon 0.14.0 bundles
this version). Use one installation route and start a new session after installing
or changing options.

## What it does

After a turn in which Claude did real work (used a tool, or gave a substantial
answer), the plugin updates a local work note in its own store: the turn count, the
first 1500 characters of the last reply, the files touched by `Edit`, `Write`,
`MultiEdit` and `NotebookEdit`, and the context usage. That costs no tokens. Trivial
turns are skipped.

The brain is written less often: after 15 minutes without a further working turn,
when the context crosses 60% and again 85% (a compaction re-arms both), before a
`/clear`, `/exit` or `/quit` typed at the prompt, and on `/hyperspell-activity now`.
Each write asks the session's own model for a short structured summary of the work
so far (a title, a summary, the decisions made, the next steps, the links involved,
and the workstream) and sends it through the Hyperspell connector's `log_activity`
tool. The entry is one per piece of work, `claude-work-<repo>--<branch>-<digest>`
(the digest includes the remote host and full namespace/path as well as the branch, distinguishing hosts, nested groups, path case and names such as `feat/paging` and `feat-paging`), so
sessions with the saved remote pointer revise that entry. A not-found read can
mean an entry is hidden, so capture leaves that id untouched and creates a fresh
`claude-work-<UUID>` entry. Its id is saved per server after a successful write and listed under
`Saved brain entries` in status;
subsequent reads, revisions and handoff signals use it. Another machine without
the pointer may create a separate entry; automatic discovery is not built. The
branch is read from `.git/HEAD` (worktrees followed, to a HEAD under a `.git`
directory after resolving `.` and `..`; this is a lexical check, not symlink resolution); a folder outside a repository is
`claude-work-cwd--<folder>-<digest>`; where the branch cannot be read the entry is
`claude-session-<session id>`. A session killed from outside does not write on its
way out; what the last write captured stands.

## Handoff

The `handoff` option (`off` by default) lets a new session continue earlier work
cheaply. With it `on`, an interactive session start (and the start after a `/clear`)
lists up to five recent work notes of this repository above the prompt:

```
Continue a session? Type its number, or just start typing.
1  <title>  <age>  next: <first next step>
```

with a `claude -r <session id>` tip to reopen the full transcript when a listed note
closed under an hour ago. Cache availability and cost vary. The current branch is
listed first, then other notes newest first. The same lines are added to the session's system prompt.
Typing a line's number as the first prompt continues that work: Claude is given the
entry and the note as hidden context (at most 9000 characters) and replies in five
lines (goal, done, next action, open questions, what it does now) before acting. Any
other first ordinary prompt takes the list down; slash commands and meta prompts
leave the choice available. Where the connected server offers
`resume_activity`, the plugin calls it with the entry id so
Hyperspell can record the resume; it never waits for it. The store keeps the thirty
most recently updated notes. With handoff `off`, no list is shown and no prompt is rewritten. Local notes
and opted-in brain captures, including entry revisions, continue.

With the daemon, run `hyperspell activity handoff on` after opting in to capture.
At setup, use both flags: `hyperspell login --activity-share suggest
--activity-handoff on`. The plugin setting is **Session handoff → on** for other
installs. Start a new interactive session to load the choice.

After a number selection, `/hyperspell-activity status` must show `resumed 1` and
a nonzero attached-character count. The list works after `/clear` because it is
prepared in plugin memory before the host discards the old session's state. The
band disappears after selection, and another number is an ordinary prompt.

The list uses this installation's local notes, not notes discovered on other
machines. Selecting a note adopts its entry ID but does not switch Git branches,
change folders, or reopen the old transcript. Check the checkout before continuing
work from another branch. The displayed `claude -r` tip is based on when a note
closed; it does not verify that a provider still has the transcript cached.

## What this plugin runs, reads and sends

The plugin is one hook module, `hooks/activity.ts`, with no commands, agents,
skills or MCP servers of its own. It runs no shell commands, starts no processes,
writes no files of its own (its notes live in the plugin store Claude Code provides),
makes no network requests of its own, and reads one kind of file: the repository's
`.git/HEAD` (and the `.git` file of a worktree), to learn the branch. Everything it
does goes through Claude Code's plugin interface, as follows.

### Hooks and what each one does

- **`session.start`**: registers the `/hyperspell-activity` command, reads one
  environment variable, `CLAUDE_CODE_ENTRYPOINT`, to label entries as coming from
  Claude Code or from Cowork. With interactive `handoff` on it reads the branch
  and local notes to prepare the list. Otherwise work is resolved lazily at the
  first working turn or explicit capture. Nothing is sent to Hyperspell here.
- **`tool.call`**: observes only. It reads the call's `agentId`, to ignore calls
  made by subagents, records "this turn used a tool" and, for `Edit`, `Write`,
  `MultiEdit` and `NotebookEdit`, the file path the call named, for the local note's
  file list. It passes every call through unchanged, never rewrites or blocks one,
  and never runs a tool. No tool input or output is stored beyond that path.
- **`turn.complete`**: after a turn of the main conversation that ended with an
  answer, it checks whether that turn used a tool or produced an answer of 400 or
  more characters. If so, it updates the local note (turn count, the reply's first
  1500 characters with credential shapes blanked, files, context usage) and restarts
  the quiet timer. At 60% and 85% context it captures at once.
- **`prompt.submit`**: with `handoff` on, a bare number as
  the first prompt is rewritten as described under Handoff. Every other prompt passes
  unchanged.
- **`prompt.compose`** and **`ui.render`** (only with `handoff` on): add the
  session-scoped system-prompt section and draw the list above the prompt.
- **`session.end`**: resets conversation state and invalidates stale captures
  before awaiting; stamps the local note closed; on `/clear`, prepares the next
  conversation's list in plugin memory. Nothing is sent to Hyperspell here.
- **`command.run`**: for `/clear`, `/exit` and `/quit`, captures pending work before
  the built-in local command runs. These commands do not submit a model prompt.
  For `/hyperspell-activity`, answers `status`, `pause`, `resume` and `now` (see
  Controls). `now` runs a capture at once.

### Calls a capture can make

Before every revision, the plugin tries `get_memory` on the selected write
server, if offered, to read `vault/activity-<entry_id>`. Up to 4000 characters go
into the summary prompt alongside the last locally saved entry. The model combines
their outcomes: another machine may have newer work, while indexing may lag behind
the latest local write. A not-found read permits a fresh-id write only, never
replacement of the unreadable entry. Other
read errors or an unreadable response stop that capture and keep work pending for
retry; a refused read pauses capture until `resume`. Servers without `get_memory`
can still capture with local context only, but cannot preserve remote-only work.
Reads and revisions are not atomic merges between simultaneous writers. If capture
switches to a fallback server, it reads and summarizes again against that server's
entry before writing, since the two servers may reach different brains.

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
   server that offers a `log_activity` tool. Calls use the session's permissions;
   a refused read or write pauses capture. Saved permissions for the exact server's
   `log_activity` and `get_memory` tool names can avoid repeated prompts;
   denying either call pauses capture; the plugin's dialog may offer only Yes and No.
   Normally one write per capture: if the server answers that it cannot
   revise an entry (an older Hyperspell adapter), the same payload is sent once more
   without `entry_id`, and captures on that server then create one entry each.
   A credential without write scope is set aside and the plugin tries the next
   available server. Status names the server that was used.

What that call sends, and nothing else: `title`, `summary`, `decisions`,
`next_steps`, `links`, `workstream` (all from the model's reply, after redaction,
see below), `agent` (`claude-code` or `claude-cowork`), `share` (the setting
below), and, except in the fallback above, `entry_id`
(`claude-work-<repo>--<branch>-<digest>`, a folder ID outside a repository, or
`claude-session-<session id>` where the branch cannot be read, or a fresh
`claude-work-<UUID>` after an ambiguous not-found read), so later captures
revise the same entry. Legacy work IDs sent to Hyperspell can contain repository
and branch slugs; fresh UUID IDs do not. The local note stays in the plugin store, and selecting a handoff
attaches its reply excerpt and recorded file paths to Claude's model context.
The plugin does not upload the full transcript or files to Hyperspell.
Where the entry goes is wherever
the chosen server sends it: for the Hyperspell connector, Hyperspell's API for your
workspace, under the connector's own credential and permissions. The connector's
privacy policy is at https://hyperspell.com/privacy.

Before anything is sent, text shaped like a credential is blanked to
`[redacted]`: private keys, API keys, bearer tokens and JWTs, `key=` / `secret=` /
`token=` / `password=` assignments, logins inside URLs, and long opaque tokens.
Links are kept only when they are `http(s)` URLs or paths relative to a project;
local absolute paths are dropped.

### Other interface use

The clock (`$.clock`) for the quiet timer and to read the time of each successful
capture, shown by `status`; the plugin store (`$.store`) for the local notes; the
session's id, folder, repository and context usage (`$.session`); toasts (`$.ui.toast`) to announce the
first capture, any pause, and the fallback from `shared` to `suggest` when the
workspace refuses direct sharing; the tool listing (`$.tool.list`) to find the
server and optional tools; and `$.ui.resolve` / `$.ui.invalidate` to draw and refresh
the handoff band. The render hook only reads the prepared list.

## Who sees an entry

The `share` option in the plugin's settings decides (the other option is `handoff`,
above), and defaults to the most
private choice that still reaches the team:

- `suggest` (default): the entry stays yours, and your Hyperspell Inbox asks
  whether to share it with the company.
- `shared`: shared with the company at once, where your workspace allows direct
  sharing; otherwise it falls back to `suggest`.
- `personal`: never asks, never shares.

With a workspace (user-less) credential every entry is the company's; `personal`
is refused there and the plugin pauses rather than write.
Changing the option does not retract an entry already shared with the company.

You can review saved entries through your agent without the dashboard. Ask it to
list your pending session entries, read the chosen entries, then share or keep
them private. Hosted MCP provides `list_sharing_requests` and
`decide_sharing_request`; the latter takes the exact source/resource ID,
`share` or `keep_private`, and `confirm=true` for a user-authorized decision.
The updated CLI provides `hyperbrain memories sharing-requests` and
`hyperbrain memories decide-sharing SOURCE RESOURCE_ID share|keep_private --confirm`.
These require a personal credential and a server with the sharing API deployed.
Installing the plugin alone does not add these tools to an older server.

Review applies to pending requests. `keep_private` dismisses a request, does not
revoke company access, and cannot reverse a previous decision. Entries saved as
`personal` create no request. Capture mode and sharing review remain independent.
Share and Keep private decisions survive revisions of the same work entry.

## Controls

Inside a session: `/hyperspell-activity status` (on or paused; entries written and
the trigger of the last; the server used; the work key and the turns noted; whether
handoff is on, how many notes are kept, and the resumes and characters attached this
session; the last problem), `pause` and `resume` (brain writes only; the local note is
still kept), and `now` (write the entry at once). Removing the plugin stops capture
entirely. With the Hyperspell sync daemon, `hyperspell activity handoff on|off`
switches the handoff.

`pause` is for this conversation and resets after `/clear`; handoff `off` disables
only the list. `hyperspell activity off` removes a daemon-managed install entirely.
Neither operation deletes local notes or existing brain entries. A short `claude
-p` run does not flush on exit; use an explicit capture when a save is required.

If the band is absent, check interactive mode, handoff enabled in the loaded
plugin, and a local note for the repository. If Claude talks about old work but
status says `resumed 0`, it has not used the full handoff. Restart after upgrading
the plugin and repeat `/clear` followed by a first ordinary prompt of `1`.

## Requirements

For the terminal, use Claude Code 2.1.287 or later. VS Code's Claude Code panel shares
CLI plugin installations; drawing the list needs extension 2.1.299 or later and
feature-flag fetching. Desktop's local Code tab needs bundled Claude Code 2.1.286
or later. See [Claude's mod support](https://code.claude.com/docs/en/plugins/mods/overview)
and [VS Code panels](https://code.claude.com/docs/en/vs-code#plugins-that-draw-in-the-panel).
An ordinary Claude web chat does not run this mod just because MCP is connected.
Where an organization manages Claude Code, install the mod through its managed
settings for all hooks to run. Personally installed mods can lose `session.compact`
and `prompt.compose` there: compaction will not re-arm the thresholds, and the small
system-prompt list is absent. Number selection uses `prompt.submit` and attaches
the full handoff independently. `claude plugin validate` reports this host policy.

The Hyperspell connector connected in your Claude account or organization, on a
Hyperspell server that offers `log_activity`. Without one the plugin writes
nothing and says so in `/hyperspell-activity status`.

Support: support@hyperspell.com

## Earlier captures and private history

Updated hosted servers preserve private checkpoints of changed activity summaries.
Agents can use `list_activity_history` and `get_activity_checkpoint` to retrieve
an earlier decision and its links on demand. These are captured summaries, not
full conversations; older overwritten content cannot be recovered retroactively.
Sharing the current entry does not share its history. Preview and confirm a
separate copy with `request_activity_checkpoint_sharing`, then use normal sharing
review to share that copy. List its pending request with `kind="all"`; the default
activity filter excludes checkpoint copies. Later captures leave it unchanged. Personal credentials
are required; installing a plugin alone does not add these server capabilities.
Checkpoints have no automatic expiry and are removed with the original entry or
owner/app erasure; separate copies have their own lifecycle. See the
[Vault guide](https://docs.hyperspell.com/integrations/all/vault#read-or-share-an-earlier-capture).
