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
inspect what is indexed. Where the Hyperspell sync daemon has synced the brain's
summary files to the machine, the skill reads those first. The plugin runs no
code, starts no server, and makes no network requests of its own; every query
goes through the connector under its own permissions and your own access.

## Requirements

The Hyperspell connector connected in your Claude account or organization. Every
answer is scoped to what your identity may see in Hyperspell.

Support: support@hyperspell.com
