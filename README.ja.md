# boulder-swarm(岩を押し上げる群れ)

**目標駆動型マルチエージェント群 —— 「検証された成果」だけを main に届ける。シーシュポスと同じく岩を押し続けるが、違うのは:岩が本当に頂上に届くこと。**

凍結されたゴールツリーが、並列のコーディングエージェントへ扇状に展開されます。各エージェントは隔離された git worktree で作業し、`main` に辿り着ける道は **マージゲート** 一本だけ —— main 上でハーネスを再実行し、失敗すれば即ロールバック。すべての主張は決定論的チェッカーで再検証されます。群れは自ら教訓を蒸留し、目標が「**本当に**達成される」まで走り続けます ——「達成したと**主張する**」までではありません。

## 実績(すべてリポジトリから再現可能)

**複雑な検証可能な数学問題を、自律的に解きました。**

- **Erdős–Straus 予想:n ≤ 10⁷ のすべての n に対し 4/n = 1/x + 1/y + 1/z を検証。**
  4世代のエージェント、4つのソルバー —— すべてそれぞれの worktree で**ゼロから**書かれたもの:
  ウィンドウ付き直接探索(E1)→ エージェントが自ら発見した**スケーリング補題** ——

  > n に証拠(witness)があれば kn にもある

  —— に問題を素数へと畳み込み(E2)、素数専用アクセラレータ(E3)、テーブル上限を廃した最終形態:**10⁷ 完全被覆・0.9 秒**(E4)。着地はすべてマージゲート経由。主張はすべて BigInt 厳密有理数で再検証。

** open な問題を 28 ラウンド攻め、一度も嘘をつきませんでした。**

- **M5:3×3 行列乗算のテンソルランク ≤ 22** —— 1976 年以来 open、Laderman の 23 に釘付け。
  この群れは:
  - **4つの独立検証済み・厳密 rank-23 スキーム**を着地(Q と F₂ の両方で厳密 —— リポジトリ自身が `R ≤ 23` を証拠立て);
  - **field-free な反証でルート族全体を閉鎖**:4つのアンカー周辺の drop-k/add-j 修復帯をすべて殺し、カウントは厳密 —— 二重ドロップ 231 通り、flatDim サバイバー 1,986、**k=6 帯の 67,000 行**(うち 11,390 行は「証明可能な clique 下界」が殺したもの)、25,459,896 行の k=5 split 帯(599/599 アンカー、control 4本すべて合格)、15,131,424 行の wide-anchor スキャン、そして最後の 1行は**有界 null ではなく**徹底的な再導出による-adjudication を残します;
  - **最後まで正直に採点**:campaign ログ 87 ラウンド、`BEST22=none` は第 1 ラウンドから最後まで不動。rank 22 が未解決の間、`goalCheck.ts` は exit 1。残された開放空間(未スクリーニング帯、アンカーと 21 項を共有しないサポート、全自由係数問題、border-rank ルート)は**名指し**され、飾られていません。

**動きながら、自らを改善しました。**

- campaign 中に **16 の実 defect** が露呈:Windows 専用のプロセスツリーkill、自らの履歴を静かに消すジャーナル、rank-23 のノイズを「解決済み」と誤判定しかねない採点マーカー、再起度をすべて凍結する lifetime/per-run 予算衝突、未マージ成果を破壊する worktree 再利用……。
  **そのすべてが、システム自身のゲートまたはジャッジに捕まり、テスト先行で修复され、そのまま倉入り**(435テスト・67ファイル・失敗ゼロ)。
- 特筆すべきセルフコレクション:エージェントは**自作ツールの誤り**(非厳密基底の上で rank 単調性が崩れること;退化部分空間のガード欠損)を自ら検出し、自分の行を書き直し/撤回。ある時は、**仮の名前で scoreboard に載るくらいなら near-miss ファイルを削除する選択**をしました。

すべて上記はリポジトリから再現可能:`CAMPAIGN.md` が 87 ラウンド分(verdict と artifact パス付き)を記録。`verifyAll.ts` は主張をすべて再導出し、drift があれば非ゼロ終了。

## 仕組み

- **凍結ゴールツリー**(`goal.yaml`):L0 目標 → 検証可能な L1 マイルストーン → 原子的 L2 タスク。自己漂流しない。
- **Worker**:`scheduler` はファイル所有権に基づき一題一 worker。実際の CLI エージェントは worker ごとの git worktree(`agent/goal-*` ブランチ)で走る。mock worker が CI を担う。
- **Verification-first**:`scoreAssignment` は証拠(CAMPAIGN 行 / artifact 存在 / scoreboard マーカー)またはハーネステストで採点 —— ただしマージ成立は `pass_rate == 1` **かつ** `total > 0` のときのみ。パース不能な 0/0 は「失敗」であり「成功」ではない。
- **マージゲート**:merge → main 上で再試験(tsc + biome 含む)→ 失敗なら revert。main への唯一の道。ロールバックが未コミット WIP を食わない(stash 保護)。
- **メモリ**:append-only の軌跡(run ごとに JSONL)、メトリクス台帳(破損ファイルは隔離、上書きしない)、自動蒸留された wiki 教訓。
- **常駐スーパーバイザ**(`--supervise`):クラッシュサバイバーラウンドは abandoned として marked + 再キュー。停止優先度は goal > budget > no-progress。同一結果の繰り返しで停止 —— 1か月ぶんのクォータを燃やし続けない。

得意なこと:有界修復スイープ、厳密ランク判定、アーカイブブランチ(`agent/goal-w0-T12@r*`)からのラダー復元、稼働中のプロセス死亡からのロスゼロ救助。

## クイックスタート

```bash
bun install
bun test                          # 435 テスト
bunx tsc --noEmit && bunx biome check src

bun src/orchestrator/runLoop.ts --workers 12          # dispatch 計画(ドライ)
bun run run                       # フル mock ループ
bun run run:opencode              # 実エージェント(無料モデル;OPENCODE_MODEL で上書き可)
bun src/orchestrator/runLoop.ts --supervise --mode opencode --tasks T12 --max-rounds 2

bun src/eval/e2eProof.ts          # E2E PASS
bun src/eval/gateProof.ts         # GATE PROOF PASS
bun src/eval/leaderboard.ts       # BENCHMARK.md を再生成

bun src/matmul/scoreboard.ts      # campaign テーブル(常に exit 0)
bun src/matmul/goalCheck.ts       # M5 のゲート:厳密 rank<=22 が存在するときのみ exit 0
bun src/matmul/tools/verifyAll.ts # 全主張を再導出;drift => 非ゼロ終了
```

**無料枠モデル**で動作(`opencode-go/space-bunny-free`;`OPENCODE_MODEL` で上書き可)。モード:`mock`(高速) · `opencode`(無料) · `codex`(サブスク)。

## 正直な限界

- open な問題は open のまま:rank ≤ 22 は**未解決**。システムは空間を狭め、witness を捏造しない。
- 体の規律:Q/R 上 `19 ≤ R ≤ 23`、F₂ 上 `21 ≤ R_F₂ ≤ 23` —— 界限は体の間で決して輸送されない。すべての artifact は自分の体を明示する。
- **決定論的チェッカー**が裁ける問題に最適:有限ドメイン探索、スキーム/厳密性 campaign、アルゴリズム課題。理論構築者ではなく、**検証者**です。

## リポジトリマップ

```
goal.yaml           # 凍結された L0→L1→L2 ゴールツリー(+ policy)
src/orchestrator/   # runLoop CLI、scheduler、git/mergeGate、agent ライフサイクル、supervisor journal
src/problems/       # 9 問の番号付きアルゴリズム課題(テストファイルがジャッジ)
src/matmul/         # M5 campaign:checker、scoreboard、goalCheck、attempts/、tools/、verify/、lit/
src/es4/            # Erdős–Straus ラダー(E1–E4)
src/eval/           # harness、e2eProof、gateProof、leaderboard
src/recording/      # append-only な trajectories/metrics/wiki ライター
BENCHMARK.md        # リーダーボード(leaderboard.ts が生成)
CAMPAIGN.md         # M5 の 87 ラウンドログ(rounds + 蒸留された知見)
```

## これが何の役に立つか

「自信に満ちた散文ではなく、**検証された**成果を生み出すはずの」エージェント系を構築しているなら —— この repo はエンドツーエンドの実装例です:ゴール分解、隔離実行、決定論的検証、正直な採点、クラッシュ耐性のある常駐スーパーバイズ、append-only の監査チェーン —— 同じリポジトリの中で、**解かれた**複雑な問題と**まだ解かれていない** open 問題の両方を走らせています。
