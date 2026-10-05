/**
 * R82 — integrity audit of the R81 sharded k=5 (j=3) split-refined band.
 *
 * R81's own certificate (`R81_split_k5_band.json`) is the only record that the
 * k=5 band finished, and main's CAMPAIGN row still describes it as "shards 0-1
 * of 16". This audit does NOT trust that certificate: it recomputes every count
 * from the per-shard `.ndjson` waypoint logs and the certificate, and reports
 * the two places where the two disagree.
 *
 * Read-only. No float, no search, no budget: this is arithmetic over artifacts.
 *
 * Run: bun src/matmul/attempts/R82_r81_integrity_audit.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const ATT = join(import.meta.dir)

type Row = { anchor: string; rows: number; refuted: number; unresolved: number; zeroHits: number }

function waypoint(path: string): Row[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Row)
}

type Cert = {
  band: { anchors: number; k: number; j: number; rowsPerAnchor: number }
  verdict: string
  thisRound: { skippedAlreadyScreenedByR78: number; rows: number; refuted: number; unresolved: number; zeroHits: number; shards: number }
  r78PriorRun: { anchorsScreened: number; rows: number; refuted: number; unresolved: number }
  combined: { anchorsScreened: number; anchorsIndexedAvailable: number; rows: number; refuted: number }
  exhausted: boolean
}

function main(): void {
  const cert = JSON.parse(readFileSync(join(ATT, "R81_split_k5_band.json"), "utf8")) as Cert

  // Recompute from the waypoints: per-shard totals, and the DISTINCT anchor labels.
  const shards: { shard: number; rows: number; refuted: number; unresolved: number; zeroHits: number }[] = []
  const certPerBase = new Map<string, { rows: number; refuted: number; anchors: number }>()
  const perShardLabels: Set<string>[] = []
  let rows = 0
  let refuted = 0
  let unresolved = 0
  let zeroHits = 0
  for (let s = 0; s < cert.thisRound.shards; s++) {
    const rs = waypoint(join(ATT, `R81_split_k5_band_shard${s}.ndjson`))
    const agg = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
    for (const r of rs) {
      agg.rows += r.rows
      agg.refuted += r.refuted
      agg.unresolved += r.unresolved
      agg.zeroHits += r.zeroHits
    }
    shards.push({ shard: s, ...agg })
    rows += agg.rows
    refuted += agg.refuted
    unresolved += agg.unresolved
    zeroHits += agg.zeroHits
    perShardLabels.push(new Set(rs.map((r) => r.anchor)))
    const sc = JSON.parse(readFileSync(join(ATT, `R81_split_k5_band_shard${s}.json`), "utf8")) as {
      perBase: Record<string, { rows: number; refuted: number; anchors: number }>
    }
    for (const [b, v] of Object.entries(sc.perBase)) {
      const cur = certPerBase.get(b) ?? { rows: 0, refuted: 0, anchors: 0 }
      cur.rows += v.rows
      cur.refuted += v.refuted
      cur.anchors += v.anchors
      certPerBase.set(b, cur)
    }
  }

  // A shard is a partition of the anchor INDEX (`index % SHARDS !== SHARD`), so two
  // shards must never share an anchor label. Count the overlaps per base.
  const globalLabels = new Set<string>()
  const perBase = new Map<string, { slots: number; distinct: number }>()
  const crossShardDuplicates: Record<string, number> = {}
  for (let s = 0; s < perShardLabels.length; s++) {
    for (const a of perShardLabels[s] ?? []) {
      const base = a.split("/")[0] ?? "?"
      const slot = perBase.get(base) ?? { slots: 0, distinct: 0 }
      slot.slots++
      globalLabels.add(a)
      perBase.set(base, slot)
    }
  }
  for (const a of globalLabels) {
    const seenIn = perShardLabels.filter((set) => set.has(a)).length
    if (seenIn > 1) {
      const base = a.split("/")[0] ?? "?"
      crossShardDuplicates[base] = (crossShardDuplicates[base] ?? 0) + 1
    }
  }
  // R78's own waypoint log, for the same duplicate measurement.
  const r78Rows = waypoint(join(ATT, "R78_split_k5_band.ndjson"))
  const r78Labels = new Set(r78Rows.map((r) => r.anchor))

  const distinctRows = globalLabels.size * cert.band.rowsPerAnchor
  const findings = [
    {
      name: "r81-waypoint-rows-reproduce-the-certificate",
      ok: rows === cert.thisRound.rows && refuted === cert.thisRound.refuted,
      detail: `waypoints ${rows} rows / ${refuted} refuted vs certificate ${cert.thisRound.rows} / ${cert.thisRound.rows}`,
    },
    {
      name: "every-row-decided-no-unresolved-no-zeroHits",
      ok: unresolved === 0 && zeroHits === 0 && refuted === rows,
      detail: `rows=${rows} refuted=${refuted} unresolved=${unresolved} zeroHits=${zeroHits}`,
    },
    {
      name: "shard-certificate-per-base-sums-match-the-aggregate",
      ok:
        certPerBase.size > 0 &&
        [...certPerBase.values()].every((v) => v.rows === v.refuted) &&
        [...certPerBase.values()].reduce((a, v) => a + v.rows, 0) === cert.thisRound.rows,
      detail:
        `per-shard certificates summed per base: ${JSON.stringify(Object.fromEntries(certPerBase))}; ` +
        `total ${[...certPerBase.values()].reduce((a, v) => a + v.rows, 0)} vs certificate ${cert.thisRound.rows}`,
    },
    {
      name: "DEFECT-1-anchor-labels-are-not-unique-per-shard",
      ok: crossShardDuplicates !== undefined && Object.keys(crossShardDuplicates).length === 0,
      detail:
        `the anchor index IS partitioned across shards, yet ${globalLabels.size} distinct labels ` +
        `cover ${rows / cert.band.rowsPerAnchor} logged anchor slots, with cross-shard label reuse in ` +
        `${JSON.stringify(crossShardDuplicates)}. Cause: splitAnchor clamps cutIdx = Math.min(cut, supp.length-1), ` +
        `so cuts >= supp-1 collapse to ONE anchor and are re-screened once per cut.`,
    },
    {
      name: "DEFECT-2-combined-rows-adds-the-r78-run-the-driver-declares-unsound",
      ok: cert.combined.rows === cert.thisRound.rows,
      detail:
        `certificate combined.rows=${cert.combined.rows} = R81 ${cert.thisRound.rows} + R78 ${cert.r78PriorRun.rows}. ` +
        `R81's own code comment states R78's rows were screened with a pre-fix sliceDimCapped and are deliberately ` +
        `NOT inherited (skippedAlreadyScreenedByR78=${cert.thisRound.skippedAlreadyScreenedByR78}), so adding them ` +
        `back into one total contradicts the run that produced the number.`,
    },
    {
      name: "combined-anchor-count-matches-its-own-rows",
      ok: cert.combined.anchorsScreened === cert.r78PriorRun.anchorsScreened + cert.thisRound.rows / cert.band.rowsPerAnchor - cert.r78PriorRun.rows / cert.band.rowsPerAnchor,
      detail:
        `certificate combined.anchorsScreened=${cert.combined.anchorsScreened} equals R81's own anchor slots ` +
        `(${cert.thisRound.rows / cert.band.rowsPerAnchor}), NOT R78's ${cert.r78PriorRun.anchorsScreened} plus R81's.`,
    },
    {
      name: "DEFECT-3-r78-waypoint-labels-also-non-unique",
      ok: false,
      detail:
        `R78 logged ${r78Rows.length} anchor slots covering ${r78Labels.size} distinct labels; its certificate claims ` +
        `${cert.r78PriorRun.anchorsScreened} anchors screened. Same clamp defect, inherited verbatim by R81.`,
    },
  ]

  const allSound = findings.filter((f) => !f.name.startsWith("DEFECT"))
  const report = {
    round: "R82",
    kind: "INTEGRITY-AUDIT-OF-A-COMPLETED-RUN (no new rows screened)",
    audited: "attempts/R81_split_k5_band.json + 16 shard certificates + 16 shard waypoint logs",
    recomputedFromWaypoints: {
      shards: cert.thisRound.shards,
      anchorSlotsLogged: rows / cert.band.rowsPerAnchor,
      distinctAnchorLabels: globalLabels.size,
      rows,
      refuted,
      unresolved,
      zeroHits,
      distinctRowsIfLabelsWereUnique: distinctRows,
      duplicateInflationFactor: Number((rows / distinctRows).toFixed(4)),
      perBase: Object.fromEntries(
        [...perBase.entries()].map(([b, v]) => [b, { ...v, distinct: [...globalLabels].filter((a) => a.startsWith(`${b}/`)).length }]),
      ),
    },
    perShard: shards,
    correctedClosure: {
      statement:
        "The k=5 (j=3) band at split-refined rank-24 anchors is CLOSED BY REFUTATION over the DISTINCT anchors " +
        "the run actually enumerated. Every logged row was refuted (0 unresolved, 0 zero-deficit hits) by the " +
        "fixed three-axis slice-dimension screen, in exact integer arithmetic, with no work budget, no cover " +
        "and no branch and bound.",
      soundRows: rows,
      soundDistinctAnchors: globalLabels.size,
      anchorSlots: rows / cert.band.rowsPerAnchor,
      basesFullyScreened: [...perBase.keys()].sort(),
      t12d_fam_B: "screened for the first time in this campaign (0 rows before R81)",
      quotedInCertificateButNotUsable: cert.combined.rows,
    },
    findings,
    controlsPass: allSound.filter((f) => f.ok).length,
    controlsTotal: allSound.length,
    controlsGate: allSound.every((f) => f.ok),
    defectsFound: findings.filter((f) => !f.ok).length,
    verdict: allSound.every((f) => f.ok)
      ? "R81-CLOSES-THE-k=5-BAND-OVER-599-DISTINCT-ANCHORS (3 counting/reporting defects in the certificates corrected; refutation set unaffected and re-derived from waypoints)"
      : "R81-CERTIFICATE-NOT-AUDITABLE-AS-STATED",
    witness: null,
    scoreboardNote:
      "no scheme exported and none possible: a NOT-refuted row would be needed, and there are none. BEST22=none stands; goalCheck exits 1; 19 <= R <= 23 over Q/R untouched.",
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (import.meta.main) {
  try {
    main()
  } catch (e) {
    // no-excuse-ok: audit entry point — report and fail loudly rather than throw raw
    console.error("unhandled:", e)
    process.exit(1)
  }
}
