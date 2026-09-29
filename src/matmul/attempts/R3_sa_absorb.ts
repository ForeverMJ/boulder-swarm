import { buildTarget } from "../types";
import { scheme as base } from "./T11_solution";

const NN = 9;
const NT = NN * NN * NN;
const VALS = [-2, -1, 0, 1, 2];

const target3 = buildTarget(3);
const target = new Array<number>(NT).fill(0);
for (let a = 0; a < NN; a++)
  for (let b = 0; b < NN; b++)
    for (let c = 0; c < NN; c++) target[a * 81 + b * 9 + c] = target3[a]?.[b]?.[c] ?? 0;

type Mats = { U: number[][]; V: number[][]; W: number[][] };

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

// Simulated annealing with 1-3 simultaneous coord moves, sideways wandering.
// Objective: minimize (mm, l1) lexicographically via energy = mm*1000 + l1.
async function main(): Promise<void> {
  const BUDGET_MS = 60_000;
  const t0 = Date.now();
  const deadline = t0 + BUDGET_MS;
  const m = matsExcept([3]);
  let got = computeGot(m);
  let s = scoreGot(got);
  let best = { ...s };
  let iters = 0;
  let accepted = 0;
  // snapshot for revert
  const snap = () => ({ U: m.U.map((r) => [...r]), V: m.V.map((r) => [...r]), W: m.W.map((r) => [...r]) });
  let cur = snap();
  const energy = (x: { mm: number; l1: number }) => x.mm * 1000 + x.l1;
  let E = energy(s);

  while (Date.now() < deadline) {
    const frac = (Date.now() - t0) / BUDGET_MS;
    const temp = 8 * (1 - frac) + 0.2; // cooling
    // propose 1-3 moves
    const nMoves = 1 + Math.floor(Math.random() * 3);
    const saved: { r: number; f: number; p: number; old: number }[] = [];
    for (let i = 0; i < nMoves; i++) {
      const r = Math.floor(Math.random() * m.U.length);
      const f = Math.floor(Math.random() * 3);
      const p = Math.floor(Math.random() * NN);
      const arr = f === 0 ? m.U[r] : f === 1 ? m.V[r] : m.W[r];
      if (arr === undefined) continue;
      const old = arr[p] ?? 0;
      const opts = VALS.filter((x) => x !== old);
      const nv = opts[Math.floor(Math.random() * opts.length)] ?? 0;
      saved.push({ r, f, p, old });
      arr[p] = nv;
    }
    const g2 = computeGot(m);
    const s2 = scoreGot(g2);
    const E2 = energy(s2);
    iters++;
    const dE = E2 - E;
    if (dE <= 0 || Math.random() < Math.exp(-dE / temp)) {
      accepted++;
      got = g2;
      s = s2;
      E = E2;
      cur = snap();
      if (s2.mm < best.mm || (s2.mm === best.mm && s2.l1 < best.l1)) {
        best = { ...s2 };
        console.log(`SA iter=${iters} accepted=${accepted} temp=${temp.toFixed(2)} new-best mm=${s2.mm} l1=${s2.l1}`);
        if (best.mm === 0) break;
      }
    } else {
      // revert
      for (const sv of saved) {
        const arr = sv.f === 0 ? m.U[sv.r] : sv.f === 1 ? m.V[sv.r] : m.W[sv.r];
        if (arr !== undefined) arr[sv.p] = sv.old;
      }
    }
    if (iters % 200_000 === 0) console.log(`SA iter=${iters} accepted=${accepted} cur=${s.mm}/${s.l1} best=${best.mm}/${best.l1}`);
    void cur;
    void got;
  }
  console.log(`T12c-SA DONE iters=${iters} accepted=${accepted} best mm=${best.mm} l1=${best.l1} elapsedMs=${Date.now() - t0}`);
}

if (import.meta.main) {
  await main();
}
