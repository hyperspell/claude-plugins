# Hyperspell plugins for Claude

Two plugins that bring the Hyperspell company brain into Claude Code, Claude
Desktop and Claude Cowork. This repository is a Claude plugin marketplace named
`hyperspell`; it is published automatically from Hyperspell's main repository.

| Plugin | What it does |
| --- | --- |
| `hyperspell-brain` | A skill that answers questions about your organization (people, projects, decisions, priorities) from the Hyperspell brain, through the Hyperspell connector. |
| `hyperspell-activity` | Logs what each Claude session did into the brain as one reviewable activity entry, written through the Hyperspell connector after every turn that did real work. |

Both need the **Hyperspell connector** connected in your Claude account or
organization; that is how they reach the brain.

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

### Claude Desktop and Cowork

Customize → Plugins → **Add marketplace**, enter `hyperspell/claude-plugins`,
then install the plugins you want. Or download the zip from your Hyperspell
dashboard (Settings → Claude plugins) and use **Upload plugin**.

### Your whole organization (Team and Enterprise)

An organization Owner uploads the plugin once under **Organization settings →
Plugins & skills** and sets it to **Installed by default** or **Required**.
Every member's Cowork and synced Claude Code sessions then have it with no
per-person step.

## What `hyperspell-activity` writes, and who sees it

After a turn that did real work, the plugin asks the model for a short summary
of the session (title, summary, decisions, next steps, links, workstream),
blanks anything shaped like a credential, and writes one entry per session,
revised in place as the session goes on. Nothing is written for trivial turns.

The `share` option (plugin settings; default `suggest`) decides visibility:

- `suggest`: the entry stays yours, and your Hyperspell Inbox asks whether to
  share it with the company.
- `shared`: shared with the company at once, where your workspace allows direct
  sharing (otherwise it falls back to `suggest`).
- `personal`: never asks, never shares.

In a session: `/hyperspell-activity status | pause | resume | now`.

## Source

The plugins are developed in Hyperspell's main repository under
`tools/cowork-plugin` and mirrored here on every release. Please report issues
to support@hyperspell.com.

## License

MIT. See [LICENSE](LICENSE).
