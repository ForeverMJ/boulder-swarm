# 其他 Coding Agent 测试指南

目的：独立审查本分支相对 `ca34d42b29c391c7f00eb394c207300d61b37f2a` 的全部修改，先验证工程正确性，再判断策略选择是否有收益。不要把本说明或模拟测试当成效果证据。

先读根目录与 `src/orchestrator/AGENTS.md`、[完整改动](strategy-changes.zh-CN.md)和[协议](../PROGRESS.md)。无需原对话、本机绝对路径或作者账号。

## 1. 获取与离线回归

在新目录执行，不要覆盖已有研究工作区：

```sh
git clone --branch codex/evidence-guided-replanning --single-branch https://github.com/ForeverMJ/boulder-swarm.git boulder-strategy-test
cd boulder-strategy-test
git rev-parse HEAD
bun --version
bun install
bun test src/orchestrator/progress.test.ts src/orchestrator/strategyTrial.test.ts src/orchestrator/codexWorker.test.ts src/orchestrator/roundLoop.test.ts
bun test
bun run typecheck
bunx @biomejs/biome@1.9.4 check src --max-diagnostics=1000
git diff --check
```

记录提交、操作系统、工具版本和各命令退出码。Biome 必须从仓库根运行才能读到 biome.jsonc。安装若修改锁文件，单独报告，不混入被测功能修改。

定向测试使用模拟 Agent、真实 Git 和子进程检查器，无需模型调用。Windows 已知 contract.test.ts 可能因目录符号链接 EPERM 失败；核实原因，不能 blanket ignore 其他失败。全仓库既有 Biome 诊断须与同工具版本的原提交对比。

参考：456 pass / 1 既有 EPERM fail；类型通过；lint 135、完整 Biome 415 个既有诊断且无新增。不要预设其他操作系统结果相同。

## 2. 主动寻找反例

| 场景 | 应观察行为 |
|---|---|
| 首次路线 | 无原方法，校验计划后执行一次 |
| continue 改 instruction | 拒绝 |
| stalled 后只改名 | 拒绝相同 instruction/experiment |
| 候选覆盖更高且验收不退化 | 可暂时选择，仍需 merge gate |
| 平局 | 保留 incumbent |
| 任一试跑失败、超时、残留进程 | 不据此宣布另一方策略更优 |
| checker 失败、范围变化、证书路径越界 | 无效证据不能接受 |
| 覆盖低于起点 | 不晋升，保留起点 |
| 验收总数不同 | 比较无效 |
| 通过数量相同但具体测试项互换 | 当前数量检查不能识别；如实报告限制 |
| 第二条路线额度不足 | 不缩短额度硬比 |
| 下一轮及重启 | 恢复 receipt 快照与已接受方法，未选中覆盖不进入高水位 |
| ledger 损坏或已 stop | 不清空历史静默继续 |
| 分支通过但整合失败，或 0/0 | 不标记任务完成 |
| 在试跑/选择/应用之间中断 | 审查日志、未记录晋升、漏记成本和重复执行 |

这是审查目标，不表示每项都有独立自动化测试。优先补充可复现反例，不只写镜像实现的断言。

## 3. 真模型运行准备

先做离线检查。模型试验需要测试者配置可用 CLI 和账号，并明确允许额度消耗。不要上传登录文件、API key 或环境变量全集。

运行器目前硬编码用本地 main 创建首轮工作区并执行合并门禁。为了运行本功能，在上面**全新的独立 clone**中创建指向功能提交的本地 main：

```sh
git switch -c main
```

这不修改远程 main；不要在已有成果仓库上 reset。保留实验提交与被测提交的对应关系。

原 goal.yaml 未启用 progress，直接跑旧任务不会自动测试新机制。在独立实验 clone 新增测试任务和可信 checker；任务仍需 id / milestone / problem / tests 字段，另加：

```yaml
progress:
  checker: tools/check-progress.ts
  scope: "your-fixed-domain-and-verifier-v1"
  maxStalledRounds: 3
timeoutMs: 600000
```

名称是占位符，必须实际实现 checker 及依赖。遵守 PROGRESS.md 的参数和 JSON 协议，独立验算固定范围的累计、去重覆盖，拒绝伪造；不接受 worker 自报计数。exhausted 必须有范围穷尽依据。

默认提示只允许修改指定 problem 文件。多文件研究任务须在测试 clone 的 `src/matmul/prompts/<TASK_ID>.md` 写明实际允许范围与产物协议，避免文件权限和任务矛盾；不要预写要探索的算法答案。

把 fixture 提交到测试 clone 的本地 main，保持工作区干净，否则新工作区可能看不到未提交的 checker、题目或测试。保留实验修改 diff，不改本分支 campaign 历史与验收来制造成功。

```sh
bun src/orchestrator/runLoop.ts --workers 1 --tasks YOUR_TASK_ID --run --mode codex
```

替换真实任务 ID；重复该命令测试后续轮次和重启。现有 supervisor 顶层目标检查仍绑定数学 campaign，自定义任务先用单轮 runLive 路径，不把 campaign 终止信号当成新任务成功。

合并 gate 检查全仓库契约，既有静态问题可能阻止落地。分别记录“分支成果有效”和“整合成功”；不要通过放宽门禁或删除原失败测试获得正结果。

## 4. 判断第三点是否成立

先固定方案，再调用模型。比较同预算三种处理：

1. 从停滞状态直接继续。
2. 多次独立尝试，用相同验收选择结果，控制额外采样收益。
3. 本分支的候选生成、原策略试跑、候选试跑和选择，计入全部调用成本。

对照 1、2 需评测者通过 adapter/runLive 注入接口或独立脚本实现；当前 CLI **没有** --baseline、自动对照或隐藏测试集开关。

使用多份真实失败/停滞快照，在独立 pilot 上校准难度，不在正式评测集上挑有利案例。正式配对冻结代码、任务、证据和验收。模型自主选路线，实验者不指定算法。所有组一轮满分时报告上限效应，不能据轻微时间差宣称策略提升。

预先记录模型版本、推理和采样设置、重复次数、顺序、资源上限、主要指标、异常和停止规则。按任务/快照配对，随机化或平衡顺序；重复调用不是独立新任务。预算不足就缩小预定样本，不事后改指标。

主要指标优先使用 worker 不可修改的最终验收；可信中间覆盖、里程碑时间和总成本为辅助。保留逐轮曲线及失败类型。若宣称可复用能力改善，再加入未参与策略生成的任务和旧任务回放。置信区间以任务/快照为单位；一次 candidate 获胜不构成统计证明。

网络/额度/执行故障单独记录。不完整配对不能把未执行组当作 0 分策略失败。按预定规则重试且保留原记录。有限证书验证不得写成解决开放数学问题。

## 5. 测试报告与交接提示

返回被测 commit、环境、命令和退出码；区分新增及基线失败。每个问题提供严重程度、文件/行号、最小复现、实际及预期行为。效果报告附预定方案、全组结果、所有调用成本、异常及证据索引。分别回答机制是否正确、是否观察到收益、是否足以支持稳定收益。阴性及不完整结果都应保留。

可直接交给测试 Agent：

> 独立审查本分支相对 ca34d42b29c391c7f00eb394c207300d61b37f2a 的全部修改。按 docs/strategy-testing.zh-CN.md 先做离线回归和反例测试，重点审查同快照配对、公平预算、验收完整性、崩溃恢复及最终合并门禁。不要把模拟测试当成真实模型效果证据，不通过改评分规则制造成功。获准使用模型额度后再进行预先固定的同预算真实停滞对照。先报告可复现问题和完整结果，不自行推送修复。
