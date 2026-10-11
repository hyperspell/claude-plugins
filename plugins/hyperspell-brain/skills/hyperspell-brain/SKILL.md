---
name: hyperspell-brain
description: >-
  Answer questions about this organization — its people, roles, projects,
  decisions, history, and priorities — from the Hyperspell company brain. Use
  whenever a question touches the org, or you would otherwise guess about who
  someone is, who owns what, or the state of a project.
---

# Company brain (Hyperspell)

Hyperspell is the source of truth for this organization — a memory layer over
everything the company knows across Slack, email, Google Drive, Notion, GitHub
and more. Consult it before answering an org question or assuming who someone
is; never guess about people, ownership, or project state when the brain can
tell you.

There are up to three ways to reach the brain, depending on how this environment
is set up. Try them in order and use the first that is available.

## 1. Live Hyperspell tools (best — synthesized, current answers)

If a Hyperspell connector is configured, you will have tools such as `ask`,
`search`, `remember`, `list_connections`, and `get_memory` (they may appear
namespaced, e.g. under `hyperspell` / `hyperspell-brain`). Prefer these:

- `ask` — a synthesized, cited answer to a natural-language question.
- `search` — ranked source documents to quote.
- `get_memory` — read an indexed source document.
- `remember` — write a durable note back into the brain.

Use `ask` for answers and `search` when you need to cite specific sources.
For current-state questions, use `recency_half_life_days` when the tool schema exposes
it and newer evidence should outrank stale near-duplicates. Follow its description
to choose a value; leave it unset for historical or evergreen questions.

## 2. The synced context files (works with no network)

If the live tools are not present but a Hyperspell brain folder has been made
available to this session — added as a working directory, or mounted (common in
sandboxed agents such as Claude Cowork) — read it directly. It is an
auto-generated, current summary of the org.

Locate it first; the folder is usually one of `~/.hyperspell`, `~/Hyperspell`, a
directory added to this session, or a path under `/mnt`. List the candidates and
read what is actually there — filenames vary per org:

- `index.md` — the directory map
- `company/` — strategy, org structure, policies, values (+ `digests/`)
- `workstreams/` — one folder per workstream: projects, priorities, roster
- `personal/` — your own context, priorities, collaborators

Read the relevant files with your normal file tools (Read / Grep / Glob) and
cite the file you drew from.

## 3. If neither is available

Tell the user the brain isn't reachable here and how to enable it, then answer
from what you already know rather than guessing:

- **To add live tools:** connect the Hyperspell remote MCP connector to your
  Claude account (Settings → Connectors).
- **To add the files:** add your Hyperspell brain folder (for example
  `~/Hyperspell`) as a working directory for this session.

## Notes

- In sandboxed environments (e.g. Claude Cowork) the agent has no direct outbound
  network, so a Hyperspell CLI call or a raw request to the API from the shell
  will **not** work — rely on the connector tools (§1, which are cloud-brokered
  and bypass the sandbox network) or the mounted files (§2).
- If the brain returns nothing or errors, fall back to the synced files, then to
  your own knowledge — do not let a failed call block your answer.
