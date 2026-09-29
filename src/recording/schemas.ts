import { z } from "zod"

export const WorkerResultSchema = z.object({
  worker_id: z.number().int().min(0),
  task_id: z.string(),
  branch: z.string(),
  passed: z.number().int().min(0),
  total: z.number().int().min(0),
  pass_rate: z.number().min(0).max(1),
  duration_s: z.number().min(0),
  loc: z.number().int().min(0),
  mode: z.enum(["mock", "codex", "opencode"]).optional(),
  ts: z.string().optional(),
})

export type WorkerResult = {
  readonly worker_id: number
  readonly task_id: string
  readonly branch: string
  readonly passed: number
  readonly total: number
  readonly pass_rate: number
  readonly duration_s: number
  readonly loc: number
  readonly mode?: "mock" | "codex" | "opencode"
  readonly ts?: string
}

export function parseResults(raw: unknown): WorkerResult[] {
  return z.array(WorkerResultSchema).parse(raw) as WorkerResult[]
}
