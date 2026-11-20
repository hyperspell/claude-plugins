// @implements specs/components/activity-capture-mod.md
// The prepared handoff list held in plugin memory across /clear.

export type HandoffItem = {
  n: number
  title: string
  age: string
  branch: string | null
  next: string | null
}

export type HandoffList = {
  items: HandoffItem[]
  // `claude -r <session id>` is cheaper while the last session's cache is warm.
  tip: string | null
}
