// @implements specs/components/activity-capture-mod.md
import type { EngineInterface, Register, Timer } from 'claude-code'

// Hyperspell activity capture (ENG-4403).
//
// After each main-loop turn that did real work, ask the session's own model for a
// short structured summary of the session so far (a fork over the main thread's
// transcript: served from the prompt cache, and the transcript never leaves the
// session), then write it through the Hyperspell MCP server this session already
// has, as ONE entry per session that each capture revises (`log_activity` with
// `entry_id`). The entry stays the user's and asks them to share it; the Inbox, the
// Slack digest and the changelog page block do the rest. Nothing here depends on the
// agent remembering to log, and nothing reaches the network directly: inside Cowork
// only the connector is reachable, and `$.mcp.call` goes through it.
//
// The hosted connector is preferred, but a connector behind a restricted API key
// cannot write (its answer names the missing `memories:write` scope): such a server is
// set aside for the conversation and the entry goes through the next one at once.

const TOOL = 'log_activity'
const COMMAND = 'hyperspell-activity'
// A turn with no tool use and a short reply is conversation, not work: no fork.
const SHORT_ANSWER_CHARS = 400
// A capture waits this long after the turn, so a run of quick turns costs one fork.
// Short on purpose: the session's end allows no fork (its hooks share a 1.5 s bound),
// so a turn followed by an exit inside this window is the one turn never captured.
const SETTLE_MS = 1000

type Share = 'suggest' | 'shared' | 'personal'

// What the first capture of a session says, per share mode. `suggest` and `personal`
// hold for a user-tied credential; a user-less workspace key makes every write the
// company's already (api/add-memory), which the Inbox then has nothing to ask about.
const ANNOUNCEMENTS: Record<Share, string> = {
  suggest: "Hyperspell is logging this session's activity as one entry; with your own credential it waits in your Hyperspell Inbox for you to share.",
  shared: "Hyperspell is logging this session's activity as one entry shared with the company.",
  personal: "Hyperspell is logging this session's activity as one entry kept to you.",
}

const PROMPT = `Summarize this session so far for your team's activity changelog. Reply with ONE JSON object and nothing else, no code fence:
{"skip": boolean, "title": string, "summary": string, "decisions": string[], "next_steps": string[], "links": string[], "workstream": string | null}
- "skip": true when the session so far produced nothing worth a changelog row (small talk, a question answered from general knowledge, reading around with no outcome); the other fields may then be empty.
- Otherwise cover the WHOLE session so far, not only the last turn. "title": at most ten words naming the outcome. "summary": two to five plain past-tense sentences on what was done and why, no preamble. "decisions": choices made, each with its reason. "next_steps": what remains. "links": URLs of the work itself (pull requests, documents, tickets) that appeared in the session; never local file paths. "workstream": the project, workstream or customer this belongs to when one was named, else null.
- Never include secrets, credentials or tokens.`

type Entry = {
  title: string
  summary: string
  decisions: string[]
  next_steps: string[]
  links: string[]
  workstream: string | null
}

type Outcome = 'logged' | 'skipped' | 'failed' | 'busy' | 'paused'

const NOW_REPLIES: Record<Exclude<Outcome, 'failed'>, string> = {
  logged: 'Logged this session so far to Hyperspell.',
  skipped: 'Nothing worth logging yet.',
  busy: 'A capture is already running; it will pick this up.',
  paused: `Capture is paused. /${COMMAND} resume first.`,
}

// Session state. A reload starts it over, as it does the session's hooks; a session's
// end resets what belongs to the conversation, since after a /clear the process goes
// on under a new session id with no session.start.
let agent = 'claude-code'
let configuredShare: Share = 'suggest'
let share: Share = 'suggest'
let server: string | undefined
// Servers whose credential cannot write this conversation (a missing write scope):
// never chosen again before the next conversation, where the credential may be fixed.
let unwritable: string[] = []
// False once the server said it cannot revise an entry (an adapter older than
// hyperspell-mcp 0.22): one entry per capture there, rather than none at all.
let reviseByEntryId = true
let paused = false
let pending = false
let usedTool = false
let inFlight: Promise<Outcome> | undefined
let timer: Timer | undefined
let generation = 0
let captures = 0
let lastCaptureAt: number | undefined
let lastError: string | undefined
let announced = false

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []

// The prompt tells the model to leave secrets out; the mod does not take its word for
// it. Credential shapes that appear in transcripts (private keys, API keys, bearer
// tokens and bare JWTs, any `...key=` / `...secret=` / `...token=` / `password=`
// assignment, long opaque tokens) are blanked before the write, so a leaked value in
// the session never reaches the brain through this path. Over-blanking a harmless
// `key=` in a summary costs a few words; under-blanking costs a credential.
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:hs2|sk|rk|pk|ghp|gho|ghu|ghs|ghr|xox[abprs])[-_][A-Za-z0-9_-]{8,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  // A credential in a URL's userinfo: `https://alice:hunter2@host/...`. Stops at `?`
  // and `#` too, so `?email=alice@example.org` is a query, not a login.
  /(?<=:\/\/)[^\s\/@?#]+(?=@)/g,
  // A JWT on its own: base64url `{"` is `eyJ` (`eyI` before an empty key), and the
  // segments are dot-joined. Header and payload may both be short (`eyIiOjB9.e30`),
  // so neither has a floor beyond that prefix.
  /\bey[IJ][A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g,
  // Any value, however short (`password=x` is still a password), and a quoted value
  // whole: `password="correct horse battery staple"` has spaces in it.
  /\b(?:[a-z_-]*(?:key|secret|token)|password|passwd|pwd)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s"',;]+)/gi,
]

// A long opaque run is a secret in free text, where nothing else is that shape.
const OPAQUE_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{48,}\b/g

// In a link's path such a run is usually a slug or a branch name (`/` and `.` bound
// it), and blanking it leaves a dead link. A slug reads as words: at least two chunks
// between separators are words of three or more letters (`Kestrel-canary-rollout-…`,
// `eng-4403-the-longest-…`), and no chunk is longer than a Notion id (32). A word has
// a letter past `f`, so a dash-grouped hex token (`abcdef-fedcba-…`) is no slug. A
// token fails one of those: `reset-<48 random>` has one word and one long chunk,
// `verify-token-<48 random>` the long chunk, a separator-split base64url run no
// words. The rest of the path is kept so the link opens; a query string or fragment
// gets no benefit of the doubt at all.
const isWord = (chunk: string): boolean => /^[A-Za-z]{3,}$/.test(chunk) && /[g-z]/i.test(chunk)
const isSlug = (run: string): boolean => {
  const chunks = run.split(/[-_]+/)
  return chunks.filter(isWord).length >= 2 && chunks.every((chunk) => chunk.length <= 32)
}

const blank = (text: string, patterns: readonly RegExp[]): string =>
  patterns.reduce((out, pattern) => out.replace(pattern, '[redacted]'), text)

export function redact(text: string): string {
  return blank(text, [...SECRET_PATTERNS, OPAQUE_TOKEN_PATTERN])
}

export function redactLink(link: string): string {
  const named = blank(link, SECRET_PATTERNS)
  const cut = named.search(/[?#]/)
  const path = cut === -1 ? named : named.slice(0, cut)
  const tail = cut === -1 ? '' : named.slice(cut)
  return (
    path.replace(OPAQUE_TOKEN_PATTERN, (run) => (isSlug(run) ? run : '[redacted]')) +
    tail.replace(OPAQUE_TOKEN_PATTERN, '[redacted]')
  )
}

// A link the team can open: an http(s) URL, or a path relative to a project. Anything
// else is dropped: a local absolute path (`/Users/...`, `~/...`, `C:\...`, `\\server\...`)
// names one machine's disk, and another scheme or a protocol-relative `//host` is not a
// link a shared entry should carry from model output.
const isShareableLink = (link: string): boolean => {
  const text = link.trim()
  return /^https?:\/\//i.test(text) || !/^([\\/]|~|[a-zA-Z]:[\\/]|[a-z][a-z0-9+.-]*:)/i.test(text)
}

// The first balanced {...} in the text, string contents included, so prose after
// the object (even prose with braces) does not break it.
function firstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function parseEntry(text: string): Entry | 'skip' | null {
  const object = firstObject(text)
  if (object === null) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(object) as Record<string, unknown>
  } catch {
    return null
  }
  if (raw.skip === true) return 'skip'
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  if (!summary) return null
  const clean = (value: string) => redact(value).trim()
  const cleanSummary = clean(summary)
  return {
    // Blanked before it is cut: a secret straddling the cut would otherwise lose the
    // length that marks it as one.
    title: clean(title || (summary.split('\n')[0] ?? summary)).slice(0, 120),
    summary: cleanSummary,
    decisions: strings(raw.decisions).map(clean),
    next_steps: strings(raw.next_steps).map(clean),
    links: strings(raw.links).filter(isShareableLink).map((link) => redactLink(link).trim()),
    workstream: typeof raw.workstream === 'string' && raw.workstream.trim() ? clean(raw.workstream) : null,
  }
}

// Which server this session writes through: one offering `log_activity`, preferring
// the hosted connector (cloud-brokered, so it works inside Cowork, and the user's own
// identity), then the server the sync daemon registers, then any other named for
// Hyperspell, then the first by name. A stable choice: a probe or test server never
// outranks the real one by sorting earlier. A server set aside as unable to write
// (`exclude`) is skipped, so the next in that order takes the entry.
export function chooseServer(toolNames: readonly string[], exclude: readonly string[] = []): string | undefined {
  const rank = (name: string) =>
    /^(claude_ai_)?hyperspell$/i.test(name)
      ? 0
      : name === 'hyperspell-context'
        ? 1
        : /hyperspell/i.test(name)
          ? 2
          : 3
  return toolNames
    .filter(name => name.startsWith('mcp__') && name.endsWith(`__${TOOL}`))
    .map(name => name.slice('mcp__'.length, -(TOOL.length + 2)))
    .filter(name => !exclude.includes(name))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0]
}

async function findServer($: EngineInterface, exclude: readonly string[] = unwritable): Promise<string | undefined> {
  return chooseServer((await $.tool.list()).map(tool => tool.name), exclude)
}

function schedule($: EngineInterface): void {
  if (timer || paused) return
  timer = $.clock.after(SETTLE_MS, () => {
    timer = undefined
    void capture($)
  })
}

function cancelTimer(): void {
  timer?.cancel()
  timer = undefined
}

// The engine refusing the mod's own call, as opposed to the server answering an
// error (which comes back as a result): the permission layer says
// `$.mcp.call(<server>, <tool>) refused: <reason>`; a hook's deny beneath the call
// (the test kit's spelling) says `$.mcp.call: <reason>`. A transport failure says
// `failed:` and is not a refusal.
const isEngineRefusal = (message: string): boolean =>
  /\$\.mcp\.call(\([^)]*\) refused|): /.test(message) && !/\$\.mcp\.call\([^)]*\) failed: /.test(message)

const errorText = (content: readonly { type: string; text?: string }[]): string =>
  content
    .map(block => (block.type === 'text' ? (block.text ?? '') : ''))
    .join(' ')
    .trim() || 'the server reported an error'

// The HTTP status a server error carries, however each path words it: the hosted
// connector says `403: this app does not allow ...`, a local server relays the
// route's `403: ...` detail or httpx's `Client error '403 Forbidden' ...`.
const statusOf = (text: string): number | undefined => {
  const match = /\b(4\d\d|5\d\d)\b/.exec(text)
  return match ? Number(match[1]) : undefined
}

// A credential that cannot write at all, as opposed to a policy the app applies to one
// share intent. The hosted connector behind a restricted API key says `requires the
// API key scope(s): memories:write`; Core's REST route answers `Missing scopes` (its
// `WrongScopes`), which a local server relays as a bare 403 (`Client error '403
// Forbidden' ...`), since only a route's `detail` is carried over. Under `suggest` or
// `personal` the route refuses nothing else with 403, so a bare 403 there is the
// credential too. Under `shared` a bare 403 is the app's direct-sharing policy first:
// the session falls back to `suggest` and captures again, and that write tells.
const isWriteRefusal = (text: string, intent: Share): boolean =>
  /requires the API key scope|Missing scopes|WrongScopes|Insufficient permissions/i.test(text) ||
  (intent !== 'shared' && statusOf(text) === 403)

async function capture($: EngineInterface): Promise<Outcome> {
  if (paused) return 'paused'
  if (inFlight) {
    pending = true
    return 'busy'
  }
  inFlight = captureNow($).finally(() => {
    inFlight = undefined
  })
  return inFlight
}

async function captureNow($: EngineInterface): Promise<Outcome> {
  // The session this capture belongs to, read before any wait: a /clear during the
  // fork must not file the old conversation's summary under the new session's id.
  const gen = generation
  const sessionId = await $.session.id()
  // After every wait, before any shared state is touched: a capture that resumes
  // once the session has ended must leave the next session's state alone.
  if (gen !== generation) return 'skipped'
  try {
    pending = false
    if (server === undefined) {
      const found = await findServer($)
      if (gen !== generation) return 'skipped'
      server = found
    }
    if (!server) {
      lastError = 'no Hyperspell MCP server in this session offers log_activity'
      return 'failed'
    }
    const reply = await $.model.fork({ prompt: PROMPT })
    if (gen !== generation) return 'skipped' // the session ended meanwhile
    if (paused) return 'paused' // the person paused while the summary was being made
    if (!reply.isAnswered) {
      lastError = `the summary was not produced (${reply.reason})`
      return 'failed'
    }
    const entry = parseEntry(reply.text)
    if (entry === null) {
      lastError = 'the summary was not the expected JSON'
      return 'failed'
    }
    if (entry === 'skip') return 'skipped'
    const args = { ...entry, agent, share }
    // One write through `via`, the first and every fallback alike: with the entry id,
    // then once more without it when the server cannot revise (and without it for the
    // rest of the session there; not once the session has ended). A server that no
    // longer offers the tool, on either call, is looked up again next time, whichever
    // session the answer reaches; everything else belongs to this session only.
    const write = async (via: string) => {
      let result = await $.mcp.call(
        via,
        TOOL,
        reviseByEntryId ? { ...args, entry_id: `claude-session-${sessionId}` } : args,
      )
      if (
        gen === generation &&
        result.isError &&
        reviseByEntryId &&
        /cannot revise an activity entry/i.test(errorText(result.content))
      ) {
        reviseByEntryId = false
        result = await $.mcp.call(via, TOOL, args)
      }
      if (result.isError && /unknown tool|not found/i.test(errorText(result.content))) {
        server = undefined
        reviseByEntryId = true // the next server is probed with the id afresh
      }
      return result
    }
    let via = server
    let result = await write(via)
    if (gen !== generation) return 'skipped' // the session ended while the write was out
    // A credential that cannot write at all is set aside for the conversation and the
    // entry goes through the next server at once; with no other server the error stands
    // and the next turn tries this one again (its connector may be fixed meanwhile).
    while (result.isError && isWriteRefusal(errorText(result.content), share)) {
      const next = await findServer($, [...unwritable, via])
      if (gen !== generation) return 'skipped'
      if (!next) break
      unwritable.push(via)
      $.ui.toast(
        `Hyperspell: ${via} cannot write activity entries (its credential lacks memories:write); writing through ${next} instead.`,
      )
      server = via = next
      reviseByEntryId = true // the next server is probed with the id afresh
      result = await write(via)
      if (gen !== generation) return 'skipped'
    }
    if (result.isError) {
      lastError = errorText(result.content)
      const status = statusOf(lastError)
      // The app's policy beats the option. `shared` needs allow_direct_share (403): fall
      // back to asking for the rest of the session rather than failing every turn.
      if (status === 403 && share === 'shared') {
        share = 'suggest'
        $.ui.toast('Hyperspell: this workspace does not allow direct sharing; entries will ask you to share instead.')
        pending = true
      }
      // `personal` needs a user-tied credential (422). A user-less key would make every
      // entry the company's, which is the one thing this option refuses: pause instead.
      if (status === 422 && share === 'personal') {
        paused = true
        $.ui.toast(
          `Hyperspell activity capture paused: this credential cannot keep entries to you. Choose suggest or shared, or /${COMMAND} resume.`,
        )
      }
      return 'failed'
    }
    captures += 1
    lastCaptureAt = await $.clock.now()
    if (gen !== generation) return 'logged' // written; the announcement is not this session's to make
    lastError = undefined
    if (!announced) {
      announced = true
      $.ui.toast(`${ANNOUNCEMENTS[share]} (through ${via}) /${COMMAND} to pause.`)
    }
    return 'logged'
  } catch (err) {
    if (gen !== generation) return 'skipped' // nothing of the next session is touched
    lastError = err instanceof Error ? err.message : String(err)
    // The engine refused the call itself (its permission layer; headless, the auto-mode
    // classifier with no one to ask). Pause rather than ask again after every turn;
    // /hyperspell-activity resume turns it back on. A server-side error never reads
    // this way: it comes back as a result, above.
    if (isEngineRefusal(lastError)) {
      paused = true
      $.ui.toast(
        `Hyperspell activity capture paused: this session did not allow the write through ${server}. /${COMMAND} resume to try again.`,
      )
    }
    return 'failed'
  } finally {
    // A turn of this session, or of the next one after a /clear, may have ended meanwhile.
    if (pending) schedule($)
  }
}

function status(): string {
  const lines = [
    `Hyperspell activity capture: ${paused ? 'paused' : 'on'} (entries ${
      captures === 0 ? 'none yet' : `${captures}, last ${new Date(lastCaptureAt ?? 0).toLocaleTimeString()}`
    }; written as ${agent}${server ? ` through ${server}` : ''}${
      unwritable.length ? `; ${unwritable.join(', ')} set aside: cannot write` : ''
    }).`,
  ]
  if (pending) lines.push('A capture is pending for the last turn.')
  if (lastError) lines.push(`Last problem: ${lastError}.`)
  lines.push(`/${COMMAND} pause | resume | now`)
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  configuredShare = options.share === 'personal' || options.share === 'shared' ? options.share : 'suggest'
  share = configuredShare

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const entrypoint = await $.env.get('CLAUDE_CODE_ENTRYPOINT')
    agent = entrypoint === 'remote_cowork' ? 'claude-cowork' : 'claude-code'
    await $.command.register({
      name: COMMAND,
      description: 'Hyperspell activity capture for this session: status, pause, resume, or log now',
      argumentHint: '[pause|resume|now]',
    })
    return result
  })

  // Whether the turn in progress used a tool, without copying the transcript.
  on('tool.call', (_$, e, next) => {
    if (e.agentId === undefined) usedTool = true
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const worked = usedTool || e.answer.length >= SHORT_ANSWER_CHARS
    usedTool = false
    if (e.reason !== 'answer' || paused || !worked) return result
    pending = true
    schedule($)
    return result
  })

  // The session's end allows no fork (one 1.5 s bound for every hook), so nothing is
  // flushed here: what the settle timer captured stands. The conversation's state is
  // reset, since a /clear goes on under a new session id with no session.start, and a
  // capture still in its fork is told not to write.
  on('session.end', async (_$, e, next) => {
    generation += 1
    cancelTimer()
    server = undefined // resolved again for the next conversation: one tool listing
    unwritable = [] // every server is tried afresh: its credential may be fixed
    reviseByEntryId = true
    usedTool = false // a turn interrupted mid-tool must not count for the next session
    pending = false
    paused = false
    share = configuredShare
    captures = 0
    announced = false
    lastError = undefined
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = e.args.trim().toLowerCase()
    if (action === 'pause') {
      paused = true
      cancelTimer()
      return { text: `Hyperspell activity capture paused for this session. /${COMMAND} resume to continue.` }
    }
    if (action === 'resume') {
      paused = false
      if (pending) schedule($)
      return { text: 'Hyperspell activity capture resumed.' }
    }
    if (action === 'now') {
      cancelTimer()
      const outcome = await capture($)
      return {
        text: outcome === 'failed' ? `Could not log: ${lastError ?? 'unknown error'}.` : NOW_REPLIES[outcome],
      }
    }
    return { text: status() }
  }).catch(() => ({ text: `Hyperspell activity capture: ${lastError ?? 'the command failed'}.` }))
}
