import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

// Cross-task attempt memory. Agents work in isolated worktrees and never see each
// other; this ledger is how one agent's failed approach reaches the next agent.
// Entries are facts (what was tried, with what budget, what happened), never
// verdicts: a failed attempt is evidence about one attempt, not a proof that the
// direction is dead. Supervisor-side append only — it writes to main directly,
// like trajectories/ and metrics/, so agent tampering in a worktree cannot land.

export const AttemptEntry = z
  .object({
    ts: z.string().min(1),
    taskId: z.string().min(1),
    route: z.string().min(1),
    covered: z.number().int().nonnegative().safe(),
    exhausted: z.boolean(),
    decision: z.enum(["continue", "replan", "stop"]),
    verdict: z.enum(["merged", "blocked", "skipped"]),
    note: z.string().max(300),
  })
  .strict()
export type AttemptEntry = z.infer<typeof AttemptEntry>

const LEDGER_NAME = "ATTEMPTS.ndjson"
const ARCHIVE_AFTER_BYTES = 10 * 1024 * 1024

export function ledgerPath(repo: string, campaignRoot: string): string {
  return join(repo, campaignRoot, LEDGER_NAME)
}

export function appendAttempt(repo: string, campaignRoot: string, entry: AttemptEntry): void {
  const path = ledgerPath(repo, campaignRoot)
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && statSync(path).size > ARCHIVE_AFTER_BYTES) {
    renameSync(path, `${path}.1`)
  }
  appendFileSync(path, `${JSON.stringify(AttemptEntry.parse(entry))}\n`, "utf-8")
}

export function readAttempts(repo: string, campaignRoot: string): AttemptEntry[] {
  const path = ledgerPath(repo, campaignRoot)
  if (!existsSync(path)) return []
  const out: AttemptEntry[] = []
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (line.trim() === "") continue
    try {
      out.push(AttemptEntry.parse(JSON.parse(line)))
    } catch {
      // Append-only ledgers meet interrupted writes; skip the torn tail line.
    }
  }
  return out
}

export function renderRecent(repo: string, campaignRoot: string, k: number): string {
  const recent = readAttempts(repo, campaignRoot).slice(-k)
  if (recent.length === 0) return ""
  const lines = recent.map(
    (e) =>
      `- ${e.ts} ${e.taskId} route=${e.route} covered=${e.covered} decision=${e.decision} gate=${e.verdict} :: ${e.note}`,
  )
  return `Prior attempts across this campaign (evidence, not prohibitions):\n${lines.join("\n")}`
}
