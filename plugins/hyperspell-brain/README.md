# Hyperspell Brain

Answers questions about your organization from the Hyperspell company brain: the
people, roles, projects, decisions, history, and priorities your company has
connected from Slack, email, Google Drive, Notion, GitHub, and more.

## What it does

The plugin adds one skill, `hyperspell-brain`, that Claude uses whenever a
question touches the organization, or whenever it would otherwise guess about
who someone is, who owns what, or the state of a project. The skill tells Claude
to consult the brain before answering and never to guess about people,
ownership, or project state when the brain can tell it.

## How it reaches the brain

Through the Hyperspell connector connected in your Claude account or
organization: `ask` for a synthesized, cited answer and `search` for ranked source
documents, with `get_memory`, `list_memories`, and `list_connections` to read and
inspect what is indexed. The plugin runs no
code, starts no server, and makes no network requests of its own; every query
goes through the connector under its own permissions and your own access.

## Requirements

The Hyperspell connector connected in your Claude account or organization. Every
answer is scoped to what your identity may see in Hyperspell.

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
