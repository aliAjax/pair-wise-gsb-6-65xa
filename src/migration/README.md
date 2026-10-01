# 配对库 → 品牌隔离空间 旧数据迁移

工作室按客户品牌分库后，旧的**全局配对编号**（收藏、评审单、已导出 CSS、站点回执共用 `pair-N`）需要迁成**品牌隔离空间**。本目录是迁移引擎（纯 TS、可测试），UI 入口为 `src/MigrationConsole.tsx`。

## 存储布局（localStorage）

旧全局数据**迁移后原样保留**，旧链接与回滚仍依赖它们：

| 键 | 内容 |
| --- | --- |
| `type-pairs` | 旧全局配对 |
| `type-favorites` / `type-reviews` / `type-exports` | 旧收藏 / 评审单 / 已导出 CSS 快照 |
| `type-brand-assignment` | 全局登记表（编号 → 品牌） |
| `type-site-receipts` | 站点回执（编号 + 别名） |

品牌隔离空间与迁移台账：

| 键 | 内容 |
| --- | --- |
| `brand:{brand}:pairs` 等 | 品牌内配对/收藏/评审/导出；品牌内编号 `localId` 独立，**同一编号在不同品牌可并存** |
| `alias-index` | 别名索引：`pair-N`（primary）、`brand:{b}:pair-N`（namespaced）、消歧项（disambiguation） |
| `migration-meta` | 每品牌状态 queued/writing/failed/migrated、尝试次数、错误、`pairMap`（旧编号→新编号）、品牌管理员确认信息 |
| `rename-journal` | 改名操作幂等日志，opId = `{brand}:{旧编号}:{kind}:{ref}`，同一改名绝不执行第二次 |

## 迁移流程

1. **迁移前核对**（`audit.ts`，纯函数）：按编号汇总收藏、评审单、发布快照与登记表声明的品牌：
   - 归属唯一且回执对平 → `migratable`；
   - 同一编号指向多个品牌 → `conflict`，`conflictSides` **逐方列出旧值**（旧全局编号、旧别名、各方收藏/评审/导出条目）；
   - 站点回执按**编号 + 别名**对账：`alias-mismatch`（如编号 4 回执写成 `pair-404`）、`duplicate-alias`、`missing-pair`（孤儿回执）→ 一律**停在待核**（`receipt-blocked`）；
   - 无任何品牌归属 → `unclaimed` 待核。
2. **裁决**（`plan.ts`）：冲突编号由**工作室管理员**裁定 `assign`（旧裸别名落到原品牌一方）或 `fork`（双方并存：第一方保留裸别名，他方用命名空间别名，裸别名进入消歧）。裁决目标必须是冲突方，否则驳回。
3. **执行**（`migrate.ts`）：
   - 按品牌成组改名写入；品牌内暂存区全部成功才整体落盘；
   - 某品牌写入失败只标记该品牌，其他品牌不受影响；**重跑只重试未完成品牌**；
   - 已 `migrated` 的品牌不重复改名（journal 幂等跳过），但允许回执补正后的**增量迁入**（只执行新增条目）；
   - 已分配的品牌内编号记账在 `pairMap`，故障后续跑稳定复用，不会重新编号。
4. **品牌确认**（`permissions.ts`）：品牌管理员**只能确认本品牌**迁移；跨品牌确认/读取/执行都被拒绝。跨品牌冲突裁决仅工作室管理员可做。
5. **旧链接与导出**（`links.ts`）：
   - `#/pair/N`、`#/N`、`#/pair-N`、`brand:{b}:pair-N`、新路由 `brand/{b}/local-N` 都可解析；
   - 并存编号的旧裸别名 → 工作室视角消歧；品牌管理员只看到本品牌候选，单候选直接落到本品牌；
   - 解析结果受品牌读权限约束（他牌 → forbidden）；
   - CSS 导出**同时保留新旧编号**（头部注释 + 尾注 `legacy-id` / `current-id` / `alias`）。

## 测试

`src/migration/__tests__/`（vitest，共 26 例）覆盖：核对结论、双方旧值、回执待核、两种裁决、品牌拆库、故障注入续跑、已迁品牌不重复改名、增量补迁、权限隔离、旧链接解析与双编号导出。

```bash
npx vitest run
```

控制台第 3 步可一键注入「Lumen 首次写入故障」演示断点续跑；第 1 步可模拟站点补正回执（`pair-404 → pair-4`）演示对平放行。
