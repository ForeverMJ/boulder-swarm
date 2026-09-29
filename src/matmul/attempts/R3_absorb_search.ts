import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTarget } from "../types";
import { scheme as base } from "./T11_solution";

const HERE = dirname(fileURLToPath(import.meta.url));
const NN = 9;
const NT = NN * NN * NN; // 729
const VALS = [-2, -1, 0, 1, 2];
const DROPS = [3, 14, 15, 21];

// Budgets (ms). Keep total ~2min.
const PER_DROP_MS = 18_000;
const PER_PAIR_MS = 8_000;
const TOP_PAIRS = 8;

const target3 = buildTarget(3);
const target = new Array<number>(NT).fill(0);
for (let a = 0; a < NN; a++)
  for (let b = 0; b < NN; b++)
    for (let c = 0; c < NN; c++) target[a * 81 + b * 9 + c] = target3[a]?.[b]?.[c] ?? 0;

type Mats = { U: number[][]; V: number[][]; W: number[][] };

function cloneMats(m: Mats): Mats {
  return {
    U: m.U.map((r) => [...r]),
    V: m.V.map((r) => [...r]),
    W: m.W.map((r) => [...r]),
  };
}

function matsExcept(drops: number[]): Mats {
  const U: number[][] = [];
  const V: number[][] = [];
  const W: number[][] = [];
  for (let s = 0; s < base.triples.length; s++) {
    if (drops.includes(s)) continue;
    const t = base.triples[s];
    if (t === undefined) continue;
    U.push([...t.u]);
    V.push([...t.v]);
    W.push([...t.w]);
  }
  return { U, V, W };
}

function computeGot(m: Mats): number[] {
  const g = new Array<number>(NT).fill(0);
  for (let r = 0; r < m.U.length; r++) {
    const u = m.U[r] ?? [];
    const v = m.V[r] ?? [];
    const w = m.W[r] ?? [];
    for (let a = 0; a < NN; a++) {
      const ua = u[a] ?? 0;
      if (ua === 0) continue;
      for (let b = 0; b < NN; b++) {
        const uv = ua * (v[b] ?? 0);
        if (uv === 0) continue;
        for (let c = 0; c < NN; c++) {
          const k = a * 81 + b * 9 + c;
          g[k] = (g[k] ?? 0) + uv * (w[c] ?? 0);
        }
      }
    }
  }
  return g;
}

function scoreGot(g: number[]): { mm: number; l1: number } {
  let mm = 0;
  let l1 = 0;
  for (let k = 0; k < NT; k++) {
    const d = (g[k] ?? 0) - (target[k] ?? 0);
    if (d !== 0) {
      mm++;
      l1 += Math.abs(d);
    }
  }
  return { mm, l1 };
}

// Incremental best-move coordinate descent on all triples jointly.
// Uses delta evaluation: changing one coord touches only a slice of `got`.
function descend(
  m: Mats,
  got: number[],
  deadline: number,
  label: string,
): { iters: number; mm: number; l1: number; sweeps: number } {
  let s = scoreGot(got);
  let iters = 0;
  let sweeps = 0;
  const R = m.U.length;
  while (Date.now() < deadline) {
    sweeps++;
    // find best single-coord move
    let best: {
      r: number;
      f: number;
      p: number;
      v: number;
      mm: number;
      l1: number;
    } | null = null;
    // factor 0=u (slice b,c for fixed a), 1=v, 2=w
    for (let r = 0; r < R; r++) {
      const u = m.U[r] ?? [];
      const v = m.V[r] ?? [];
      const w = m.W[r] ?? [];
      // u coords
      for (let a0 = 0; a0 < NN; a0++) {
        const cur = u[a0] ?? 0;
        for (const nv of VALS) {
          if (nv === cur) continue;
          const delta = nv - cur;
          let mm = 0;
          let l1 = 0;
          for (let b = 0; b < NN; b++) {
            const vb = v[b] ?? 0;
            if (vb === 0 && true) {
              // still need w check; skip fast if vb==0 (no change)
              // delta*0*w = 0 so got unchanged on this row
              // but must still count existing mismatches in slice
            }
            for (let c = 0; c < NN; c++) {
              const k = a0 * 81 + b * 9 + c;
              const ch = delta * vb * (w[c] ?? 0);
              const d = (got[k] ?? 0) + ch - (target[k] ?? 0);
              if (d !== 0) {
                mm++;
                l1 += Math.abs(d);
                // prune: can't beat current best-mm scan? keep simple, no prune
              }
            }
          }
          // total mm = (global mm in unaffected entries) + mm in slice.
          // Compute unaffected by subtracting current slice contribution.
          // Instead compute full delta precisely: compare slice old vs new.
          // To avoid full rescan, compute slice old mm/l1 then combine.
          // Simpler: compute full new mm by scanning all 729 (cheap enough at this scale?
          // 2970 moves * 729 = 2.1M ops per sweep — fine in bun).
          // So do exact full rescan via delta array? Just do direct full check below.
          // Placeholder: mark for exact evaluation if promising.
          // Exact evaluation: apply delta mentally is complex; do full loop over k using
          // precomputed per-k change (only slice changes).
          // Compute global new mm exactly:
          let gmm = s.mm;
          let gl1 = s.l1;
          // subtract old slice contribution, add new
          for (let b = 0; b < NN; b++) {
            for (let c = 0; c < NN; c++) {
              const k = a0 * 81 + b * 9 + c;
              const oldD = (got[k] ?? 0) - (target[k] ?? 0);
              const vb = v[b] ?? 0;
              const ch = delta * vb * (w[c] ?? 0);
              const newD = oldD + ch;
              if (oldD !== 0 && newD === 0) {
                gmm--;
                gl1 -= Math.abs(oldD);
              } else if (oldD === 0 && newD !== 0) {
                gmm++;
                gl1 += Math.abs(newD);
              } else if (oldD !== 0 && newD !== 0) {
                gl1 += Math.abs(newD) - Math.abs(oldD);
              }
            }
          }
          iters++;
          if (gmm < s.mm || (gmm === s.mm && gl1 < s.l1)) {
            if (best === null || gmm < best.mm || (gmm === best.mm && gl1 < best.l1)) {
              best = { r, f: 0, p: a0, v: nv, mm: gmm, l1: gl1 };
              if (gmm === 0) break;
            }
          }
          void mm;
          void l1;
        }
        if (best !== null && best.mm === 0) break;
      }
      if (best !== null && best.mm === 0) break;
      // v coords
      for (let b0 = 0; b0 < NN; b0++) {
        const cur = v[b0] ?? 0;
        for (const nv of VALS) {
          if (nv === cur) continue;
          const curU = m.U[r] ?? [];
          const curW = m.W[r] ?? [];
          let gmm = s.mm;
          let gl1 = s.l1;
          for (let a = 0; a < NN; a++) {
            const ua = curU[a] ?? 0;
            if (ua === 0) {
              // change is 0 unless... ua*nv*w - ua*cur*w = ua*(nv-cur)*w = 0. skip
              continue;
            }
            const dlt = ua * (nv - cur);
            for (let c = 0; c < NN; c++) {
              const k = a * 81 + b0 * 9 + c;
              const oldD = (got[k] ?? 0) - (target[k] ?? 0);
              const newD = oldD + dlt * (curW[c] ?? 0);
              if (oldD !== 0 && newD === 0) {
                gmm--;
                gl1 -= Math.abs(oldD);
              } else if (oldD === 0 && newD !== 0) {
                gmm++;
                gl1 += Math.abs(newD);
              } else if (oldD !== 0 && newD !== 0) {
                gl1 += Math.abs(newD) - Math.abs(oldD);
              }
            }
          }
          iters++;
          if (gmm < s.mm || (gmm === s.mm && gl1 < s.l1)) {
            if (best === null || gmm < best.mm || (gmm === best.mm && gl1 < best.l1)) {
              best = { r, f: 1, p: b0, v: nv, mm: gmm, l1: gl1 };
              if (gmm === 0) break;
            }
          }
        }
        if (best !== null && best.mm === 0) break;
      }
      if (best !== null && best.mm === 0) break;
      // w coords
      for (let c0 = 0; c0 < NN; c0++) {
        const cur = w[c0] ?? 0;
        for (const nv of VALS) {
          if (nv === cur) continue;
          const curU = m.U[r] ?? [];
          const curV = m.V[r] ?? [];
          let gmm = s.mm;
          let gl1 = s.l1;
          for (let a = 0; a < NN; a++) {
            const ua = curU[a] ?? 0;
            if (ua === 0) continue;
            for (let b = 0; b < NN; b++) {
              const uv = ua * (curV[b] ?? 0);
              if (uv === 0) continue;
              const k = a * 81 + b * 9 + c0;
              const oldD = (got[k] ?? 0) - (target[k] ?? 0);
              const newD = oldD + uv * (nv - cur);
              if (oldD !== 0 && newD === 0) {
                gmm--;
                gl1 -= Math.abs(oldD);
              } else if (oldD === 0 && newD !== 0) {
                gmm++;
                gl1 += Math.abs(newD);
              } else if (oldD !== 0 && newD !== 0) {
                gl1 += Math.abs(newD) - Math.abs(oldD);
              }
            }
          }
          iters++;
          if (gmm < s.mm || (gmm === s.mm && gl1 < s.l1)) {
            if (best === null || gmm < best.mm || (gmm === best.mm && gl1 < best.l1)) {
              best = { r, f: 2, p: c0, v: nv, mm: gmm, l1: gl1 };
              if (gmm === 0) break;
            }
          }
        }
        if (best !== null && best.mm === 0) break;
      }
      if (best !== null && best.mm === 0) break;
    }
    if (best === null) break; // local optimum
    // apply best move, update got incrementally
    const uu = m.U[best.r] ?? [];
    const vv = m.V[best.r] ?? [];
    const ww = m.W[best.r] ?? [];
    if (best.f === 0) {
      const old = uu[best.p] ?? 0;
      const dlt = best.v - old;
      uu[best.p] = best.v;
      for (let b = 0; b < NN; b++)
        for (let c = 0; c < NN; c++) {
          const k = (best.p ?? 0) * 81 + b * 9 + c;
          got[k] = (got[k] ?? 0) + dlt * (vv[b] ?? 0) * (ww[c] ?? 0);
        }
    } else if (best.f === 1) {
      const old = vv[best.p] ?? 0;
      const dlt = best.v - old;
      vv[best.p] = best.v;
      for (let a = 0; a < NN; a++)
        for (let c = 0; c < NN; c++) {
          const k = a * 81 + (best.p ?? 0) * 9 + c;
          got[k] = (got[k] ?? 0) + (uu[a] ?? 0) * dlt * (ww[c] ?? 0);
        }
    } else {
      const old = ww[best.p] ?? 0;
      const dlt = best.v - old;
      ww[best.p] = best.v;
      for (let a = 0; a < NN; a++)
        for (let b = 0; b < NN; b++) {
          const k = a * 81 + b * 9 + (best.p ?? 0);
          got[k] = (got[k] ?? 0) + (uu[a] ?? 0) * (vv[b] ?? 0) * dlt;
        }
    }
    s = { mm: best.mm, l1: best.l1 };
    if (sweeps % 25 === 0) console.log(`${label} sweep=${sweeps} iters=${iters} mm=${s.mm} l1=${s.l1}`);
    if (s.mm === 0) break;
  }
  return { iters, mm: s.mm, l1: s.l1, sweeps };
}

function perturb(m: Mats, nMoves: number): void {
  for (let i = 0; i < nMoves; i++) {
    const r = Math.floor(Math.random() * m.U.length);
    const f = Math.floor(Math.random() * 3);
    const p = Math.floor(Math.random() * NN);
    const arr = f === 0 ? m.U[r] : f === 1 ? m.V[r] : m.W[r];
    if (arr === undefined) continue;
    const cur = arr[p] ?? 0;
    const opts = VALS.filter((x) => x !== cur);
    arr[p] = opts[Math.floor(Math.random() * opts.length)] ?? 0;
  }
}

function randomSparseVec(size: number): number[] {
  const v = new Array<number>(NN).fill(0);
  const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = idx[i] ?? 0;
    idx[i] = idx[j] ?? 0;
    idx[j] = t;
  }
  for (let i = 0; i < size; i++) {
    const p = idx[i] ?? 0;
    v[p] = [-1, 1][Math.floor(Math.random() * 2)] ?? 1;
  }
  return v;
}

// isotropy: simultaneous index relabel (i,j)->(pi(i),pi(j)) on every u,v,w
function isotropy(m: Mats, pi: number[]): Mats {
  const map = (vec: number[]): number[] => {
    const out = new Array<number>(NN).fill(0);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const src = i * 3 + j;
        const dst = (pi[i] ?? 0) * 3 + (pi[j] ?? 0);
        out[dst] = vec[src] ?? 0;
      }
    return out;
  };
  return {
    U: m.U.map(map),
    V: m.V.map(map),
    W: m.W.map(map),
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  let globalBest = {
    mm: Number.MAX_SAFE_INTEGER,
    l1: Number.MAX_SAFE_INTEGER,
    desc: "",
    mats: null as Mats | null,
    drops: [] as number[],
  };
  let totalIters = 0;

  const consider = (m: Mats, got: number[], desc: string, drops: number[]) => {
    const s = scoreGot(got);
    if (s.mm < globalBest.mm || (s.mm === globalBest.mm && s.l1 < globalBest.l1)) {
      globalBest = { mm: s.mm, l1: s.l1, desc, mats: cloneMats(m), drops: [...drops] };
      console.log(`NEW-BEST ${desc} mm=${s.mm} l1=${s.l1}`);
      void writeFile(
        join(HERE, "T12c_best.json"),
        JSON.stringify({ desc, drops, mm: s.mm, l1: s.l1, U: m.U, V: m.V, W: m.W }, null, 1),
      ).catch(() => {});
    }
  };

  // Phase 1: single-drop absorb with restarts
  for (const d of DROPS) {
    const deadline = Date.now() + PER_DROP_MS;
    let restarts = 0;
    let bestLocal = { mm: Number.MAX_SAFE_INTEGER, l1: Number.MAX_SAFE_INTEGER };
    // start from clean removal
    const m0 = matsExcept([d]);
    let got0 = computeGot(m0);
    consider(m0, got0, `drop${d}-init`, [d]);
    let cur = cloneMats(m0);
    let got = [...got0];
    while (Date.now() < deadline) {
      restarts++;
      const r = descend(cur, got, deadline, `drop${d}-r${restarts}`);
      totalIters += r.iters;
      const s = { mm: r.mm, l1: r.l1 };
      if (s.mm < bestLocal.mm || (s.mm === bestLocal.mm && s.l1 < bestLocal.l1)) {
        bestLocal = s;
        console.log(`drop${d} restart=${restarts} sweeps=${r.sweeps} iters=${r.iters} mm=${s.mm} l1=${s.l1}`);
        consider(cur, got, `drop${d}-r${restarts}`, [d]);
      }
      if (s.mm === 0) break;
      // perturb from best-known for this drop (small kick), recompute got
      perturb(cur, 2 + Math.floor(Math.random() * 3));
      got = computeGot(cur);
      // if perturbation exploded, restart from clean + small kick occasionally
      if (restarts % 6 === 0) {
        cur = cloneMats(m0);
        perturb(cur, 3);
        got = computeGot(cur);
      }
    }
    console.log(`DROP${d} DONE restarts=${restarts} best=${bestLocal.mm}/${bestLocal.l1}`);
    if (globalBest.mm === 0) break;
  }

  // Phase 1b: isotropy orbits then drop-absorb (shorter budget each)
  if (globalBest.mm !== 0) {
    const full = matsExcept([]);
    for (const pi of [[2, 1, 0], [1, 2, 0]]) {
      const iso = isotropy(full, pi);
      for (const d of DROPS) {
        const deadline = Date.now() + Math.floor(PER_DROP_MS / 2);
        const m: Mats = {
          U: iso.U.filter((_, i) => {
            // map original index s -> kept; drops refers to original triple idx
            const kept: number[] = [];
            for (let s = 0; s < base.triples.length; s++) if (s !== d) kept.push(s);
            return kept.includes(i);
          }),
          V: iso.V.filter((_, i) => {
            const kept: number[] = [];
            for (let s = 0; s < base.triples.length; s++) if (s !== d) kept.push(s);
            return kept.includes(i);
          }),
          W: iso.W.filter((_, i) => {
            const kept: number[] = [];
            for (let s = 0; s < base.triples.length; s++) if (s !== d) kept.push(s);
            return kept.includes(i);
          }),
        };
        const got = computeGot(m);
        consider(m, got, `iso${pi.join("")}-drop${d}-init`, [d]);
        const r = descend(m, got, deadline, `iso${pi.join("")}-drop${d}`);
        totalIters += r.iters;
        console.log(`ISO${pi.join("")} DROP${d} mm=${r.mm} l1=${r.l1} iters=${r.iters}`);
        consider(m, got, `iso${pi.join("")}-drop${d}`, [d]);
        if (globalBest.mm === 0) break;
      }
      if (globalBest.mm === 0) break;
    }
  }

  // Phase 2: drop pairs + one fresh sparse triple (rank 21+1=22)
  if (globalBest.mm !== 0) {
    // rank pair removals by raw mm
    const pairs: { d1: number; d2: number; mm: number }[] = [];
    for (let d1 = 0; d1 < base.triples.length; d1++)
      for (let d2 = d1 + 1; d2 < base.triples.length; d2++) {
        const m = matsExcept([d1, d2]);
        const s = scoreGot(computeGot(m));
        pairs.push({ d1, d2, mm: s.mm });
      }
    pairs.sort((a, b) => a.mm - b.mm);
    console.log(`PAIRS-top${TOP_PAIRS} ${pairs.slice(0, TOP_PAIRS).map((p) => `(${p.d1},${p.d2})=${p.mm}`).join(" ")}`);
    for (const p of pairs.slice(0, TOP_PAIRS)) {
      const deadline = Date.now() + PER_PAIR_MS;
      const kept = matsExcept([p.d1, p.d2]);
      // attach one fresh sparse triple
      kept.U.push(randomSparseVec(2));
      kept.V.push(randomSparseVec(2));
      kept.W.push(randomSparseVec(2));
      const got = computeGot(kept);
      consider(kept, got, `pair(${p.d1},${p.d2})-init`, [p.d1, p.d2]);
      const r = descend(kept, got, deadline, `pair(${p.d1},${p.d2})`);
      totalIters += r.iters;
      console.log(`PAIR(${p.d1},${p.d2}) mm=${r.mm} l1=${r.l1} iters=${r.iters}`);
      consider(kept, got, `pair(${p.d1},${p.d2})`, [p.d1, p.d2]);
      if (globalBest.mm === 0) break;
      if (Date.now() - t0 > 240_000) break;
    }
  }

  console.log(
    `T12c-ABSORB DONE best mm=${globalBest.mm} l1=${globalBest.l1} desc=${globalBest.desc} drops=${globalBest.drops.join(",")} totalIters=${totalIters} elapsedMs=${Date.now() - t0}`,
  );
  await writeFile(
    join(HERE, "T12c_best.json"),
    JSON.stringify(
      {
        desc: globalBest.desc,
        drops: globalBest.drops,
        mm: globalBest.mm,
        l1: globalBest.l1,
        totalIters,
        U: globalBest.mats?.U,
        V: globalBest.mats?.V,
        W: globalBest.mats?.W,
      },
      null,
      1,
    ),
  );
}

if (import.meta.main) {
  await main();
}
