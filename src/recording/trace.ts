import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

export async function appendEvent(repoRoot: string, runId: string, event: unknown): Promise<string> {
  const dir = join(repoRoot, "trajectories")
  await mkdir(dir, { recursive: true })
  const fp = join(dir, `${runId}.jsonl`)
  await appendFile(fp, `${JSON.stringify(event)}\n`, "utf-8")
  return fp
}
