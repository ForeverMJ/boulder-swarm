import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The free model tier degrades in waves: sometimes a model hangs (probe times
// out with zero output), sometimes it fakes work (exit 0, no edit), sometimes
// it is silently retired server-side (muse-spark-1.3-contributor-free went 500
// mid-campaign). A single hardcoded model stalls the whole run whenever its
// wave hits. This pool probes candidates with a REAL edit task and picks the
// first that actually performs it - the file content, never the exit code, is
// the verdict, because fake-work exits 0. OPENCODE_MODEL still overrides the
// pool entirely.
//
// Pool refresh 2026-10-21: all entries below passed a live edit-probe (each
// performed `x = 1 -> x = 2` within 100s). Verified-dead or too-slow models
// dropped: muse-spark-1.3-contributor-free (server 500), cat-jam-free (gone),
// beam-free / flint-40b-free / longcat-2.5-preview-free (probe timeout).
// Order: strongest code models first, big-pickle as the proven-campaign fallback.
export const DEFAULT_MODEL_POOL: readonly string[] = [
  "opencode/nemotron-3-ultra-free",
  "opencode/glm-5.3-flash-free",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/big-pickle",
  "opencode/minimax-m3.1-flash-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode-go/minimax-m3.1-flash-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/nemotron-3.5-super-vl-free",
]

export type ProbeFn = (model: string) => Promise<boolean>

export async function selectHealthyModel(
  pool: readonly string[],
  probe: ProbeFn,
): Promise<string | undefined> {
  for (const model of pool) {
    if (await probe(model)) return model
  }
  return undefined
}

export async function probeModelEdit(model: string, timeoutMs = 150_000): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "modelprobe-"))
  try {
    const file = join(dir, "probe.ts")
    await writeFile(file, "export const x = 1\n", "utf-8")
    spawnSync("opencode", ["run", "--dir", dir, "-m", model, "--auto",
      "Edit probe.ts: change x = 1 to x = 2."], { cwd: dir, timeout: timeoutMs, stdio: "ignore" })
    const after = await readFile(file, "utf-8").catch(() => "")
    return after.includes("x = 2")
  } catch {
    return false
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// After a timeout-class failure the current model is suspect; re-probe just it,
// keep it if still healthy, otherwise fall through to the pool order.
export async function reselectModel(
  current: string,
  pool: readonly string[],
  probe: ProbeFn,
): Promise<string | undefined> {
  if (await probe(current)) return current
  return selectHealthyModel(pool, probe)
}
