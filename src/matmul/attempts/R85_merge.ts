/**
 * R85 merge — decide closure of the m=2 wide-anchor layer from the per-shard certificates.
 *
 * A merge that merely summed the shards' `rowsScreened` would be the R71/R84 mistake in a
 * new costume: it would report a number without ever comparing it to the PLAN, so a shard
 * that died early would still produce a confident-looking total. The decision here is
 * therefore stated as an equality that must hold, per base:
 *
 *     anchorsScreened + anchorsRefused === anchorsPlanned
 *
 * `anchorsPlanned` is the DP count in `bigint` written by each shard, not an estimate. If
 * the equality fails for any base the layer is reported UNSCREENED for that base, and an
 * unscreened band is never called refuted. Only when it holds for every base does the layer
 * become CLOSED-EXACTLY, and even then the claim is about rank-22 schemes sharing 21 terms
 * with an enumerated anchor — never about rank 22 in general.
 */
import { readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

type ShardPayload = {
  round: string
  m: number
  shard: number
  shards: number
  rowsPerAnchor: number
  rowsScreened: number
  rowsRefuted: number
  rowsUndecided: number
  rowsSurvivor: number
  seconds: number
  timedOut: boolean
  oracleRows: number
  oracleDisagreements: number
  witness: number
  survivors: unknown[]
  controls: { name: string; pass: boolean; gating: boolean }[]
  bases: {
    base: string
    anchorsPlanned: string
    anchorsScreened: number
    anchorsRefused: number
    rowsPerAnchor: number
    rowsScreened: number
  }[]
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const m = Number(process.env["R85_M"] ?? 2)
    const shards = Number(process.env["R85_SHARDS"] ?? 24)
    const names = (await readdir(HERE)).filter((f) =>
      f.startsWith(`R85_m${m}_shard`) && f.endsWith(`of${shards}.json`),
    )
    if (names.length === 0) {
      console.log(`no R85_m${m} shard certificates found - nothing to merge, nothing claimed`)
      return
    }

    const payloads: ShardPayload[] = []
    for (const n of names) {
      payloads.push(JSON.parse(await readFile(join(HERE, n), "utf8")) as ShardPayload)
    }

    const shardIds = payloads.map((p) => p.shard).sort((a, b) => a - b)
    const distinct = new Set(shardIds)
    const rowsScreened = payloads.reduce((a, p) => a + p.rowsScreened, 0)
    const rowsRefuted = payloads.reduce((a, p) => a + p.rowsRefuted, 0)
    const rowsUndecided = payloads.reduce((a, p) => a + p.rowsUndecided, 0)
    const rowsSurvivor = payloads.reduce((a, p) => a + p.rowsSurvivor, 0)
    const witness = payloads.reduce((a, p) => a + p.witness, 0)
    const survivors = payloads.flatMap((p) => p.survivors)
    const oracleRows = payloads.reduce((a, p) => a + p.oracleRows, 0)
    const oracleDisagreements = payloads.reduce((a, p) => a + p.oracleDisagreements, 0)
    const timedOutShards = payloads.filter((p) => p.timedOut).map((p) => p.shard)
    const wallSeconds = Math.max(...payloads.map((p) => p.seconds))

    // Per-base closure: every anchor of that base must be either screened or refused.
    const byBase = new Map<
      string,
      { planned: bigint; screened: number; refused: number; rowsPerAnchor: number }
    >()
    for (const p of payloads) {
      for (const b of p.bases) {
        const cur =
          byBase.get(b.base) ??
          { planned: 0n, screened: 0, refused: 0, rowsPerAnchor: b.rowsPerAnchor }
        cur.planned = BigInt(b.anchorsPlanned)
        cur.screened += b.anchorsScreened
        cur.refused += b.anchorsRefused
        cur.rowsPerAnchor = b.rowsPerAnchor
        byBase.set(b.base, cur)
      }
    }
    const bases = [...byBase.entries()].map(([base, v]) => {
      const decided = BigInt(v.screened + v.refused)
      return {
        base,
        anchorsPlanned: v.planned.toString(),
        anchorsScreened: v.screened,
        anchorsRefused: v.refused,
        anchorsDecided: decided.toString(),
        anchorsUndecided: v.planned > decided ? (v.planned - decided).toString() : "0",
        rowsPerAnchor: v.rowsPerAnchor,
        rowsPlanned: (v.planned * BigInt(v.rowsPerAnchor)).toString(),
        closed: v.planned === decided,
      }
    })
    const allClosed = bases.every((b) => b.closed) && distinct.size === shards
    const anyGatingFail = payloads.some((p) =>
      p.controls.some((c) => c.gating && !c.pass),
    )

    const rowsPlanned = bases.reduce((a, b) => a + BigInt(b.rowsPlanned), 0n)

    const payload = {
      round: "R85-merge",
      m,
      shards,
      shardsPresent: names.length,
      shardsDistinct: distinct.size,
      shardIdsPresent: shardIds,
      allShardsPresent: distinct.size === shards,
      timedOutShards,
      rowsPerAnchor: payloads[0]?.rowsPerAnchor ?? 0,
      rowsPlanned: rowsPlanned.toString(),
      rowsScreened,
      rowsRefuted,
      rowsSurvivor,
      rowsUndecided,
      // `bigint` so an unscreened remainder is never rounded into a double; stringified
      // because `JSON.stringify` cannot serialise a BigInt.
      rowsUnscreened: (rowsPlanned - BigInt(rowsScreened)).toString(),
      survivorRate: rowsScreened > 0 ? rowsSurvivor / rowsScreened : 0,
      ratesPerSecond: wallSeconds > 0 ? Math.round(rowsScreened / wallSeconds) : 0,
      slowestShardSeconds: wallSeconds,
      oracleRows,
      oracleDisagreements,
      anyGatingControlFailed: anyGatingFail,
      bases,
      survivors,
      witness,
      verdict: !allClosed
        ? "BOUNDED-INCOMPLETE - the shard set or an anchor space is incomplete; the remainder is UNSCREENED and is never called refuted"
        : witness > 0
          ? "WITNESS EXISTS - see survivors[] and re-run checker.verify() on it"
          : rowsSurvivor > 0
            ? "SURVIVORS EXIST - see survivors[]; no exact rank<=22 scheme"
            : "CLOSED-EXACTLY over the entire m=2 anchor space",
      scope: [
        `every one of the ${rowsScreened} screened rows was decided by an exact integer test, so this is a REFUTATION of the screened band, not a bounded null: no budget, no branch and bound, no sampling, no floating point`,
        "the claim is about rank-22 schemes sharing 21 terms with a TWO-support-split refinement of T11_solution / T12d_fam_A / T12d_fam_B; it does NOT bound rank 22 in general",
        "rank-22 schemes sharing NO 21 terms with any enumerated anchor remain untouched - the class R74 named as the main open ground",
        "the m=3 layer is not attempted here and is UNSCREENED",
        "integer arithmetic: a refutation holds over Q, Z and every F_p alike",
        "no bound moves: 19 <= R <= 23 over Q/R stands untouched",
      ],
    }
    const out = join(HERE, `R85_m${m}_merge.json`)
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(`shards ${distinct.size}/${shards} present`)
    for (const b of bases) {
      console.log(
        `  ${b.base}: anchors ${b.anchorsDecided}/${b.anchorsPlanned} decided (screened ${b.anchorsScreened}, refused ${b.anchorsRefused}) rowsPlanned ${b.rowsPlanned} closed=${b.closed}`,
      )
    }
    console.log(
      `rows screened ${rowsScreened} refuted ${rowsRefuted} survivor ${rowsSurvivor} undecided ${rowsUndecided} unscreened ${payload.rowsUnscreened}`,
    )
    console.log(`oracle rows ${oracleRows} disagreements ${oracleDisagreements}`)
    console.log(`VERDICT: ${payload.verdict}`)
    console.log(`wrote ${out}`)
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
