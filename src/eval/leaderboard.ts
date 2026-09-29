import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

type Row = {
  task: string
  passed: number
  total: number
  rate: number
  duration: number | null
  branch: string
  gate: string
  mode: string
}

function liveFirst(mode: string): number {
  return mode === "mock" ? 1 : 0
}

async function loadEvents(): Promise<Row[]> {
  const dir = join(REPO, "trajectories")
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"))
  } catch (e) {
    if (e instanceof Error) {
      files = []
    } else {
      throw e
    }
  }
  const best = new Map<string, Row>()
  for (const f of files) {
    const lines = (await readFile(join(dir, f), "utf-8")).split("\n")
    for (const ln of lines) {
      if (ln.trim() === "") continue
      try {
        const e = JSON.parse(ln) as {
          type?: unknown
          task_id?: unknown
          passed?: unknown
          total?: unknown
          pass_rate?: unknown
          duration_s?: unknown
          branch?: unknown
          mode?: unknown
        }
        if (e.type !== "worker_result" || typeof e.task_id !== "string") continue
        const mode = typeof e.mode === "string" ? e.mode : "mock"
        const row: Row = {
          task: e.task_id,
          passed: typeof e.passed === "number" ? e.passed : 0,
          total: typeof e.total === "number" ? e.total : 0,
          rate: typeof e.pass_rate === "number" ? e.pass_rate : 0,
          duration: typeof e.duration_s === "number" ? e.duration_s : null,
          branch: typeof e.branch === "string" ? e.branch : "",
          gate: "",
          mode,
        }
        const prev = best.get(row.task)
        if (
          prev === undefined ||
          row.rate > prev.rate ||
          (row.rate === prev.rate && liveFirst(row.mode) < liveFirst(prev.mode)) ||
          (row.rate === prev.rate &&
            liveFirst(row.mode) === liveFirst(prev.mode) &&
            (row.duration ?? 1e18) < (prev.duration ?? 1e18))
        ) {
          best.set(row.task, row)
        }
      } catch (e) {
        if (e instanceof Error) {
          continue
        }
        throw e
      }
    }
  }
  return [...best.values()]
}

function gateMerges(): Map<string, string> {
  const out = new Map<string, string>()
  try {
    const r = spawnSync("git", ["log", "--format=%s", "--reverse"], { cwd: REPO, encoding: "utf-8", timeout: 30_000 })
    for (const line of `${r.stdout ?? ""}`.split("\n")) {
      const m = line.match(/merge (agent\/\S+-(T\d+)) /)
      if (m?.[1] !== undefined && m?.[2] !== undefined) {
        out.set(m[2], m[1])
      }
    }
  } catch (e) {
    if (e instanceof Error) {
      // git history unavailable, gate column stays empty
    } else {
      throw e
    }
  }
  return out
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const rows = await loadEvents()
    const gates = gateMerges()
    const byTask = new Map(rows.map((r) => [r.task, r]))
    for (const [task, branch] of gates) {
      const row = byTask.get(task)
      if (row === undefined) {
        byTask.set(task, { task, passed: 0, total: 0, rate: 0, duration: null, branch, gate: "merged", mode: "gate" })
      } else {
        row.branch = branch
        row.gate = "merged"
      }
    }
    const ranked = [...byTask.values()].sort(
      (a, b) => b.rate - a.rate || liveFirst(a.mode) - liveFirst(b.mode) || (a.duration ?? 1e18) - (b.duration ?? 1e18),
    );
    const lines = [
      "# Benchmark Leaderboard",
      "",
      `Generated: ${new Date().toISOString()} | Model: opencode/muse-spark-1.3-contributor-free (override: OPENCODE_MODEL)`,
      "",
      "| Rank | Task | Pass | Rate | Agent time (s) | Mode | Branch | Gate |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...ranked.map((r, i) => {
        const pass = r.total === 0 && r.gate === "merged" ? "solved" : `${r.passed}/${r.total}`
        return `| ${i + 1} | ${r.task} | ${pass} | ${r.rate.toFixed(2)} | ${r.duration === null ? "--" : r.duration.toFixed(2)} | ${r.mode} | ${r.branch} | ${r.gate} |`
      }),
      "",
      "Rate = harness pass rate on the worker branch. Gate = merge commit on main. Missing times predate per-agent timing.",
      "",
    ]
    await writeFile(join(REPO, "BENCHMARK.md"), lines.join("\n"), "utf-8")
    console.log(`wrote BENCHMARK.md with ${ranked.length} rows`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
