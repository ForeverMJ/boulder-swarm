"""R83 — INDEPENDENT verification of the k=5 (j=3) split-refined band closure.

Nothing here imports the repo's screen. The target tensor is dumped from
`types.buildTarget` (the single shared input), and from there everything --
anchor enumeration, slice-dimension rank, row screening -- is re-derived in
Python with exact `fractions.Fraction` Gaussian elimination.
"""
import itertools
import json
import os
import re
import sys
from fractions import Fraction

N = 9
K = 5
J = K - 2  # 3
ROOT = "/home/taotao/workspace/dev/boulder-swarm-worktrees/worker_0/src/matmul"
NN = 3


def idx(a, b):
    return a * NN + b


def target_indep():
    """The Kronecker/transposition tensor, re-derived here from its definition
    (T[idx(i,j)][idx(j,k)][idx(i,k)] = 1) rather than imported from the repo."""
    t = [0] * (N * N * N)
    for i in range(NN):
        for j in range(NN):
            for k in range(NN):
                t[(idx(i, j) * N + idx(j, k)) * N + idx(i, k)] = 1
    return t


TARGET = target_indep()

# Cross-check against the repo's own buildTarget when a dump is available. This is the
# ONLY shared input in the script, and a disagreement here is a hard failure.
_d = os.environ.get("R83_TARGET_DUMP", "/tmp/opencode/target.json")
if os.path.exists(_d):
    _repo = json.load(open(_d))
    if _repo != TARGET:
        raise SystemExit(f"TARGET MISMATCH vs repo buildTarget: {sum(1 for a, b in zip(_repo, TARGET) if a != b)} entries differ")

TRIPLE_RE = re.compile(r"\{\s*u:\s*\[([^\]]*)\],\s*v:\s*\[([^\]]*)\],\s*w:\s*\[([^\]]*)\]\s*\}")


def load_scheme(name):
    txt = open(f"{ROOT}/attempts/{name}.ts").read()
    out = []
    for m in TRIPLE_RE.finditer(txt):
        out.append([tuple(int(x) for x in g.split(",")) for g in m.groups()])
    return out


BASES = {
    "T11_solution": load_scheme("T11_solution"),
    "T12_rank23_variant": load_scheme("T12_rank23_variant"),
    "T12d_fam_A": load_scheme("T12d_fam_A"),
    "T12d_fam_B": load_scheme("T12d_fam_B"),
}


def split_anchor(label, terms, ti, mode, cut):
    t = terms[ti]
    f = t[mode]
    supp = [i for i in range(N) if f[i] != 0]
    if len(supp) < 2:
        return None
    cut_idx = min(cut, len(supp) - 1)
    if cut_idx < 1:
        return None
    p, q = list(f), list(f)
    for r, i in enumerate(supp):
        if r < cut_idx:
            q[i] = 0
        else:
            p[i] = 0
    left = (p, t[1], t[2]) if mode == 0 else ((t[0], p, t[2]) if mode == 1 else (t[0], t[1], p))
    right = (q, t[1], t[2]) if mode == 0 else ((t[0], q, t[2]) if mode == 1 else (t[0], t[1], q))
    out = [x for i, x in enumerate(terms) if i != ti]
    out.extend([left, right])
    return {"label": f"{label}/t{ti}/m{mode}/c{cut_idx}", "terms": out}


def inventory():
    for label, terms in BASES.items():
        for ti in range(len(terms)):
            for mode in range(3):
                for cut in range(1, 8):
                    a = split_anchor(label, terms, ti, mode, cut)
                    if a is not None:
                        yield a


def slice_dim(mat):
    """dim over Q of the span of 9 integer 9x9 matrices, by exact elimination."""
    rows = [[Fraction(x) for x in row] for m in mat for row in m]
    rank = 0
    for col in range(N):
        piv = next((r for r in range(rank, len(rows)) if rows[r][col] != 0), None)
        if piv is None:
            continue
        rows[rank], rows[piv] = rows[piv], rows[rank]
        pv = rows[rank][col]
        rows[rank] = [x / pv for x in rows[rank]]
        for r in range(len(rows)):
            if r != rank and rows[r][col] != 0:
                f = rows[r][col]
                rows[r] = [x - f * y for x, y in zip(rows[r], rows[rank])]
        rank += 1
    return rank


def screen(deficit):
    """Return (refuted, per-axis slice dims). Refutation = some axis has dim > J."""
    dims = []
    for ax in range(3):
        sl = []
        for i in range(N):
            m = [[0] * N for _ in range(N)]
            for j in range(N):
                for k in range(N):
                    idx = (i, j, k) if ax == 0 else ((j, i, k) if ax == 1 else (j, k, i))
                    m[j][k] = deficit[idx]
            sl.append(m)
        dims.append(slice_dim(sl))
    return max(dims) > J, dims


def term_add(out, t, sign):
    for a in range(N):
        if t[0][a] == 0:
            continue
        for b in range(N):
            if t[1][b] == 0:
                continue
            for c in range(N):
                if t[2][c] == 0:
                    continue
                    # placeholder to keep structure readable
                if t[2][c] != 0:
                    out[(a, b, c)] += sign * t[0][a] * t[1][b] * t[2][c]


def main():
    labels = [a["label"] for a in inventory()]
    distinct = set(labels)
    print(f"independent inventory: {len(labels)} positions, {len(distinct)} distinct labels")

    covered = {}
    import glob
    files = ["R78_split_k5_band.ndjson"] + sorted(glob.glob(f"{ROOT}/attempts/R82_shard*.ndjson"))
    nrows = 0
    for f in files:
        for line in open(f"{ROOT}/attempts/{f}" if "/" not in f else f):
            if not line.strip():
                continue
            r = json.loads(line)
            nrows += 1
            lab = r["anchor"]
            if lab in covered:
                if (covered[lab]["rows"], covered[lab]["refuted"]) != (r["rows"], r["refuted"]):
                    print("CLASH", lab)
            covered.setdefault(lab, r)
    print(f"ndjson lines read: {nrows}; distinct covered labels: {len(covered)}")
    missing = distinct - set(covered)
    unknown = set(covered) - distinct
    print(f"missing (enumerated but unscreened): {len(missing)}; unknown (screened but not enumerated): {len(unknown)}")
    per_base = {}
    for lab in covered:
        per_base.setdefault(lab.split("/")[0], set()).add(lab)
    print("distinct anchors covered per base:", {b: len(v) for b, v in sorted(per_base.items())})
    bad = [l for l, r in covered.items() if r["rows"] != 42504 or r["refuted"] != 42504 or r["unresolved"] or r["zeroHits"]]
    print(f"labels whose row is not a clean 42504/42504 refutation: {len(bad)}")
    print(f"TOTAL distinct rows accounted: {len(covered) * 42504}")

    # ---- re-screen a sample of rows with the independent instrument ----
    by_label = {a["label"]: a for a in inventory()}
    sample = []
    for base in ["T12d_fam_B", "T12d_fam_A", "T11_solution", "T12_rank23_variant"]:
        labs = sorted(per_base[base])
        for pick in (0, len(labs) // 2, len(labs) - 1):
            sample.append(labs[pick])
    checked = 0
    agree = 0
    disagree = []
    for lab in sample:
        anchor = by_label[lab]
        terms = anchor["terms"]
        n = len(terms)
        assert n == 24, (lab, n)
        allk = list(itertools.combinations(range(n), K))
        probes = [allk[0], allk[len(allk) // 2], allk[-1]]
        for ks in probes:
            drop = set(ks)
            d = {}
            for idx in range(N * N * N):
                d[(idx // (N * N), (idx // N) % N, idx % N)] = TARGET[idx]
            for i, t in enumerate(terms):
                if i not in drop:
                    term_add(d, t, -1)
            refuted, dims = screen(d)
            checked += 1
            if refuted:
                agree += 1
            else:
                disagree.append((lab, list(ks), dims))
    print(f"independent re-screen: {checked} rows probed, {agree} refuted, {len(disagree)} NOT refuted")
    for d in disagree[:10]:
        print("  NOT REFUTED:", d)
    # ---- control: zero-deficit alignment. Dropping NOTHING from an exact anchor must
    # leave D = 0 exactly; if the deficit construction or the target were misaligned,
    # this control fires. A screen that refuted it would be refuting the truth.
    misaligned = []
    for lab in sample[:6]:
        anchor = by_label[lab]
        d = {(a, b, c): TARGET[(a * N + b) * N + c] for a in range(N) for b in range(N) for c in range(N)}
        for t in anchor["terms"]:
            term_add(d, t, -1)
        nz = sum(1 for x in d.values() if x != 0)
        refuted, dims = screen(d)
        if nz != 0 or refuted:
            misaligned.append((lab, nz, dims))
    print(f"zero-deficit alignment control: {6 - len(misaligned)}/6 anchors give D = 0 and are NOT refuted")
    for m in misaligned:
        print("  MISALIGNED:", m)

    print("VERDICT:", "consistent" if not missing and not unknown and not bad and not disagree else "INCONSISTENT")
    return 0 if (not missing and not unknown and not bad and not disagree and not misaligned) else 1


if __name__ == "__main__":
    sys.exit(main())