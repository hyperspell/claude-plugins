# Hyperspell plugins for Claude

Two plugins that bring the Hyperspell company brain into Claude Code, Claude
Desktop and Claude Cowork. This repository is a Claude plugin marketplace named
`hyperspell`; it is published automatically from Hyperspell's main repository.

| Plugin | What it does |
| --- | --- |
| `hyperspell-brain` | A skill that answers questions about your organization (people, projects, decisions, priorities) from the Hyperspell brain, through the Hyperspell connector. |
| `hyperspell-activity` | Logs what your Claude sessions did into the brain as one reviewable activity entry per piece of work (repository and branch), written through the Hyperspell connector once the work settles. Optionally lists your recent work when a session starts, so a number continues it. |

Both need the **Hyperspell connector** connected in your Claude account or
organization; that is how they reach the brain. Step-by-step instructions, the
connector included:
https://docs.hyperspell.com/agents/claude#add-the-hyperspell-plugins

## Install

### Claude Code

```
/plugin marketplace add hyperspell/claude-plugins
/plugin install hyperspell-activity@hyperspell
/plugin install hyperspell-brain@hyperspell
```

If you run the Hyperspell sync daemon, you do not need the marketplace for
activity capture: `hyperspell activity suggest` installs the same plugin, and
your agent can run that for you when you ask it to turn activity capture on.

Daemon 0.17.0 bundles activity plugin 0.2.1. Choose one installation route for
activity capture, and start a new Claude session after installation or an option
change. The behavior below describes plugin 0.2.1; older copies write more often.

Terminal mods need Claude Code 2.1.287 or later. The VS Code extension shares CLI
plugin installs; its handoff panel requires 2.1.299 or later and feature-flag
fetching. Local Desktop Code sessions need bundled Claude Code 2.1.286 or later.
See [Claude's supported surfaces](https://code.claude.com/docs/en/plugins/mods/overview)
and [VS Code plugin panels](https://code.claude.com/docs/en/vs-code#plugins-that-draw-in-the-panel).
The Hyperspell MCP connection alone does not install activity capture in another
agent, including Codex, or in an ordinary Claude web chat.

### Claude Desktop and Cowork

The plugins are not in Claude's plugin directory yet, so searching for
Hyperspell under Customize → Plugins will not find them. For now, install them
one of these two ways:

- **From this repository:** Customize → Plugins → **Add marketplace**, enter
  `hyperspell/claude-plugins`, then install the plugins you want.
- **From the zip** (`hyperspell-activity` only): download
  https://app.hyperspell.com/plugins/hyperspell-activity-latest.zip (EU accounts:
  https://app.eu.hyperspell.com/plugins/hyperspell-activity-latest.zip) and use
  **Upload plugin**.

Once they are listed, you can install them from Claude's plugin directory
instead.

### Your whole organization (Team and Enterprise)

An organization Owner uploads the zip above once under **Organization settings →
Plugins & skills** and sets it to **Installed by default** or **Required**.
Every member's Cowork and synced Claude Code sessions then have it with no
per-person step.

## What `hyperspell-activity` writes, and who sees it

Each turn that did real work is noted in the plugin's local store, at no token
cost. After 15 minutes of quiet, when the context crosses 60% and 85%, before a
`/clear`, `/exit` or `/quit`, and on request, the plugin asks the model for a short
summary of the work so far (title, summary, decisions, next steps, links,
workstream), blanks anything shaped like a credential, and writes one entry per
repository and branch when Git metadata is available (per session when the
branch cannot be read), revised by sessions with its saved remote pointer. If a
read says not found, it may be hidden: capture leaves it untouched and creates a
fresh UUID entry, saving that id locally per server after success. Another machine
without the pointer may create a separate entry. Nothing is written
for trivial turns. The initial legacy-ID lookup can include readable repository and branch slugs;
a fresh entry after a not-found response uses a UUID.
The plugin does not upload the full transcript or files to Hyperspell. Local notes
contain a redacted reply excerpt and recorded file paths; selecting a handoff
attaches them to Claude's model context. Closing a terminal does not flush pending
work; run `/hyperspell-activity now` when you need it saved before closing.

The `share` option (plugin settings; default `suggest`) decides visibility:

- `suggest`: the entry stays yours, and your Hyperspell Inbox asks whether to
  share it with the company.
- `shared`: shared with the company at once, where your workspace allows direct
  sharing (otherwise it falls back to `suggest`).
- `personal`: never asks, never shares.

With a workspace credential every entry is company-visible and `personal` is
refused. Changing the option does not retract an already shared entry.

You can also review pending entries through your agent. Ask it to list and read
your session entries, then share or keep selected entries private. Hosted MCP
`list_sharing_requests` and `decide_sharing_request` use your personal credential
and the same rules as the Inbox. The updated hyperbrain CLI offers
`memories sharing-requests` and `memories decide-sharing`. These require an updated
server; installing this plugin alone does not add the sharing tools.
`keep_private` dismisses a pending request and cannot revoke a previous share or
reverse an earlier decision.

The `handoff` option (default `off`) lists up to five recent work notes of the
repository above the prompt when a session starts or after `/clear`; typing a line's number as the
first prompt continues that work with its entry and note attached as context. With
the sync daemon, `hyperspell activity handoff on|off` switches it.

Enable capture first, then handoff:

```bash
hyperspell activity suggest
hyperspell activity handoff on
hyperspell activity status          # suggest (handoff on)
```

At setup use `hyperspell login --activity-share suggest --activity-handoff on`.
The first ordinary prompt consumes the list; other text dismisses it and later
numbers pass through unchanged. Slash commands leave the choice available. After
selecting a note, status must show `resumed 1` and nonzero attached characters.
The list is local to this plugin installation; choosing another branch's note
does not switch Git branches or folders.

Before each revision, capture can read the previous brain entry with `get_memory`
and combine it with the locally saved entry. A handoff can signal `resume_activity` if the server offers it. Neither
optional tool is required for the local list, and the plugin does not merge
concurrent revisions from different machines.

In a session: `/hyperspell-activity status | pause | resume | now`.

Pause stops brain writes while local notes continue. Handoff `off` hides only the
list. `hyperspell activity off` removes the daemon-managed plugin; for a marketplace
or upload install, remove it through Claude. Existing brain entries remain.

If a read or write is refused, capture pauses. For persistent permission in Claude Code,
allow the exact `mcp__<server>__log_activity` tool in settings, and in auto mode
`mcp__<server>__get_memory` too (auto mode refuses the plugin's timer-driven read
with no verdict), then run `resume`. The plugin approves its own `get_memory` read
of the entry it revises when the engine would ask, and no other read. The Hyperspell
sync daemon saves the write rule for its `hyperspell-context` server when it installs
the plugin (0.17.0 or later) and the read rule as well (0.19.0 or later). Other read failures leave work pending for retry;
the plugin's permission dialog may offer only Yes and No. See the
[plugin reference](plugins/hyperspell-activity/README.md) for privacy and diagnostics.

## Source

The plugins are developed in Hyperspell's main repository under
`tools/cowork-plugin` and mirrored here on every release. Please report issues
to support@hyperspell.com.

## License

MIT. See [LICENSE](LICENSE).

## Codex

Codex uses a separate native activity plugin with local hooks and explicit handoff.
See [Codex setup](https://docs.hyperspell.com/agents/codex). Installing this Claude
marketplace does not install the Codex adapter. Their local notes and timing differ.

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
