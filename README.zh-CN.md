# boulder-swarm(推石者的蜂群)

**目标驱动的多智能体蜂群:只交付"被验证过"的结果——和西西弗斯一样推石,不同的是:石头成功上了山(进了 main)。**

一份冻结的目标树扇出到并行编码 agent,每个 agent 在隔离的 git worktree 里干活。能进 `main` 的路只有一条:合并门——在 main 上重新跑一遍 harness,失败即回滚。每一条 claim 都由确定性 checker 重新推导。蜂群自己蒸馏经验、自己继续迭代,直到目标**真的**完成——而不是它**声称**完成。

## 战果(全都可以从仓库复现)

**它自主解决了一个复杂的可验证数学问题。**

- **Erdős–Straus 猜想:对每一个 n ≤ 10⁷,验证 4/n = 1/x + 1/y + 1/z。**
  四代 agent、四个求解器,每一代都在自己的 worktree 里**从零写出**:
  带窗口的直接搜索(E1)→ agent 自己发现的**缩放引理**——"n 有解则 kn 有解",把问题塌缩到素数(E2)→ 素数专扫加速器(E3)→ 无表上限的终版:**10⁷ 全覆盖,0.9 秒**(E4)。
  每一次落地都过合并门;每一条结论都由 BigInt 精确有理数复核。

**它对一个开放问题跑了 28 轮,一次都没有说谎。**

- **M5:3×3 矩阵乘法张量秩 ≤ 22**——1976 年开放至今,钉在 Laderman 23。
  蜂群:
  - 落地 **4 个彼此独立验证的精确 rank-23 方案**(在 Q **和** F₂ 上都精确,仓库自身见证 `R ≤ 23`);
  - 然后用 **field-free 反证关死整条路线族**:四个锚点周边所有 drop-k/add-j 修复带全部判死,且计数精确——231 个二丢组合、1,986 个 flatDim 幸存者、**k=6 带的 67,000 行**(其中可证 clique 下界杀掉 11,390 行)、25,459,896 行的 k=5 劈分带(599/599 锚点、四道 control 全绿)、15,131,424 行的 wide-anchor 扫描、以及最后一行以穷尽重推导(而非有界 null)收尾的单点裁决;
  - **全程诚实记分**:战役日志 87 轮,`BEST22=none` 从第 1 轮站立到最后;`goalCheck.ts` 在 rank 22 未解时 exit 1。剩余开放空间(未筛带、与锚点无 21 项共享的支撑、全自由系数问题、border-rank 路线)全部被**点名**——没有糖衣。

**它在工作过程中完成了自我改进。**

- 战役期间暴露 **16 个真实缺陷**:Windows-only 的进程树击杀、会静默清零自身历史的 journal、会让 rank-23 噪声假判"已解"的评分语义、冻结一切重启的 lifetime/per-run 预算冲突、会摧毁未合并工件的 worktree 复用……
  **每一个都被系统自己的门或裁判抓住、测试先行修复、判据入仓**(435 个测试、67 个文件、零失败)。
- 值得一提的自我纠错:agent 发现**自己**仪器的错误(rank 单调性在非精确基底上不成立;退化子空间的守卫缺陷),重写并撤回自己的行;有一次**宁可把一个 near-miss 方案文件删掉,也不让它顶着假名字上 scoreboard**。

以上全部可复现:`CAMPAIGN.md` 记录 87 轮(含 verdict 与 artifact 路径);`verifyAll.ts` 重新推导每一条 claim,发现漂移即非零退出。

## 工作原理

- **冻结目标树**(`goal.yaml`):L0 目标 → 可验证的 L1 里程碑 → 原子 L2 任务,不允许自行漂移。
- **Worker**:`scheduler` 按文件所有权一题一 worker;真实 CLI agent 在每 worker 独立 git worktree 的 `agent/goal-*` 分支上干活;mock worker 覆盖 CI。
- **验证优先**:`scoreAssignment` 以证据打分(CAMPAIGN 行/工件存在性/scoreboard 标记)或跑 harness——但合并只在 `pass_rate == 1` **且** `total > 0` 时成立;解析不出的 0/0 是失败,不是成功。
- **合并门**:merge → 在 main 上再考(tsc + biome)→ 失败即回滚。这是进 main 的唯一路径;闸门回滚永远不会吃掉未提交的 WIP(有 stash 保护)。
- **记忆**:append-only 轨迹(每次 run 一份 JSONL)、指标账本(损坏文件被隔离,绝不覆盖)、自动蒸馏的 wiki 经验。
- **长驻 supervisor**(`--supervise`):崩溃幸存轮标记 abandoned 并重新入队;停止优先级 goal > budget > no-progress;同样的结果重复出现就停机,而不是烧一个月配额。

它最擅长的场景:有界修复扫、精确秩判定、从归档分支(`agent/goal-w0-T12@r*`)复源整套梯子、进程中途死亡的无损抢救。

## 快速开始

```bash
bun install
bun test                          # 435 个测试
bunx tsc --noEmit && bunx biome check src

bun src/orchestrator/runLoop.ts --workers 12          # 派发计划(干跑)
bun run run                       # 完整 mock 回路
bun run run:opencode              # 真实 agent(免费模型;OPENCODE_MODEL 可覆盖)
bun src/orchestrator/runLoop.ts --supervise --mode opencode --tasks T12 --max-rounds 2

bun src/eval/e2eProof.ts          # E2E PASS
bun src/eval/gateProof.ts         # GATE PROOF PASS
bun src/eval/leaderboard.ts       # 重新生成 BENCHMARK.md

bun src/matmul/scoreboard.ts      # 战役计分表(永远 exit 0)
bun src/matmul/goalCheck.ts       # M5 的门:存在精确 rank<=22 才 exit 0
bun src/matmul/tools/verifyAll.ts # 重推每一条 claim;漂移 => 非零退出
```

跑在**免费档模型**上(`opencode-go/space-bunny-free`;`OPENCODE_MODEL` 可覆盖)。模式:`mock`(快)· `opencode`(免费)· `codex`(订阅)。

## 诚实的边界

- 开放问题保持开放:rank ≤ 22 **没有**被解决;系统缩小空间、拒绝伪造 witness。
- 域纪律:Q/R 上 `19 ≤ R ≤ 23`,F₂ 上 `21 ≤ R_F₂ ≤ 23`——界限绝不在域之间搬运;每个 artifact 必须注明自己的域。
- 最适合"确定性 checker 能裁定"的问题:有限域搜索、方案/精确性战役、算法题。它是**验证者**,不是理论建构者。

## 仓库地图

```
goal.yaml           # 冻结的 L0→L1→L2 目标树(+ policy)
src/orchestrator/   # runLoop CLI、scheduler、git/mergeGate、agent 生命周期、supervisor journal
src/problems/       # 9 道编号算法题(测试文件即裁判)
src/matmul/         # M5 战役:checker、scoreboard、goalCheck、attempts/、tools/、verify/、lit/
src/es4/            # Erdős–Straus 阶梯(E1–E4)
src/eval/           # harness、e2eProof、gateProof、leaderboard
src/recording/      # append-only 的 trajectories/metrics/wiki 写手
BENCHMARK.md        # 排行榜(leaderboard.ts 生成)
CAMPAIGN.md         # M5 的 87 轮日志(rounds + 蒸馏结论)
```

## 这个项目给你什么

如果你正要构建"应该产出**被验证过**的工作、而不是自信的散文"的 agentic 系统,这个仓库是一个端到端的成品示例:目标分解、隔离执行、确定性验证、诚实记分、崩溃可容忍的长驻监督、append-only 审计链——并在同一个仓库里,同时跑过一个被解决的复杂问题和一个仍未被解决的开放问题。
