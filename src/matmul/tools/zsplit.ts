import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { Scorer } from "./scorer"
import { applyTriple, findAutomorphisms, orderOf, tripleKey } from "./symmetry"
import type { Scheme } from "../types"
import type { Automorphism } from "./symmetry"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

type Triple = { u: readonly number[]; v: readonly number[]; w: readonly number[] }

function orbitOf(g: Automorphism, t: Triple): Triple[] {
  const out: Triple[] = [t]
  let cur = applyTriple(g, t)
  for (let k = 0; k < 2; k++) {
    out.push(cur)
    cur = applyTriple(g, cur)
  }
  return out
}

function orbitPartition(g: Automorphism, triples: readonly Triple[]): Triple[][] {
  const remaining = [...triples]
  const out: Triple[][] = []
  while (remaining.length > 0) {
    const head = remaining.shift()
    if (head === undefined) break
    const orb = orbitOf(g, head)
    out.push(orb)
    for (const t of orb) {
      const k = tripleKey(t)
      const idx = remaining.findIndex((r) => tripleKey(r) === k)
      if (idx >= 0) remaining.splice(idx, 1)
    }
  }
  return out
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const name = args[0] ?? "T11_solution.ts"
    const out = args[1] ?? "R11_zsplit.json"
    const lo = Number.parseInt(args[2] ?? "-2", 10)
    const hi = Number.parseInt(args[3] ?? "2", 10)
    const rounds = Number.parseInt(args[4] ?? "400", 10)
    const mod = (await import(join(ATT, name))) as { scheme: Scheme }
    const autos = findAutomorphisms(mod.scheme.n)
    const g3 = autos.find((a) => orderOf(a) === 3)
    if (g3 === undefined) {
      await writeFile(join(ATT, out), JSON.stringify({ error: "no order-3 automorphism" }, null, 2), "utf-8")
      console.log("no order-3 automorphism found")
      return
    }
    const parts = orbitPartition(g3, mod.scheme.triples)
    const sizes = parts.map((p) => p.length)
    const fixed = parts.filter((p) => p.length === 1).length
    const covered = sizes.reduce((a, b) => a + b, 0)
    const z3Invariant = covered === mod.scheme.triples.length && fixed > 0
    console.log(
      `orbits=${parts.length} sizes=${JSON.stringify(sizes)} fixedTriples=${fixed} rank=${mod.scheme.triples.length} covered=${covered} z3Invariant=${z3Invariant}`,
    )

    // A Z3-invariant rank-22 ansatz needs 1 + 7*3 terms: drop one fixed triple.
    const invariant = sizes.every((s) => s === 1 || s === 3)
    const fixedKeys = new Set(parts.filter((p) => p.length === 1).map((p) => tripleKey(p[0] ?? { u: [], v: [], w: [] })))
    const t0 = Date.now()
    let best = { mm: Number.POSITIVE_INFINITY, l1: Number.POSITIVE_INFINITY, dropFixed: "" }
    const attempts: unknown[] = []
    if (invariant && fixedKeys.size >= 2) {
      for (const key of fixedKeys) {
        const base = mod.scheme.triples.filter((t) => tripleKey(t) !== key)
        const sc = new Scorer(mod.scheme.n, base)
        const gt = verify({ n: mod.scheme.n, triples: base })
        attempts.push({ dropped: key.slice(0, 24), mm: sc.mm, l1: sc.l1, rank: base.length, truth: gt.correct })
        if (sc.mm < best.mm) best = { mm: sc.mm, l1: sc.l1, dropFixed: key.slice(0, 24) }
      }
    }
    const payload = {
      family: name,
      groupOrderHistogram: autos.reduce<Record<string, number>>((h, a) => {
        const k = String(orderOf(a))
        h[k] = (h[k] ?? 0) + 1
        return h
      }, {}),
      orbitSizes: sizes,
      coveredTriples: covered,
      z3Invariant,
      fixedTriples: fixed,
      invariant,
      dropFixedAttempts: attempts,
      best,
      verdict: best.mm === 0 ? "CANDIDATE" : "no-invariant-drop-solution",
      elapsedMs: Date.now() - t0,
      coefficientRange: [lo, hi],
      rounds,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} best=${best.mm}/${best.l1} ${payload.elapsedMs}ms -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
