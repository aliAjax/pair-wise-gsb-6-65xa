# 配对库品牌隔离迁移

把历史上共用全局配对编号的「收藏 / 评审单 / 已导出 CSS / 发布快照 / 站点回执」迁到按客户品牌隔离的空间。

## 模型

- 旧世界：`type-pairs` 全局数字编号，所有业务单据混引同一编号。
- 新世界：配对主键为品牌空间内新编号 `uid`（如 `P-0001`，品牌内连续），同时长期保留 `legacyId`（旧全局编号）。
- 同一旧编号可以在不同品牌下各存一份独立副本；`legacyIndex: legacyId -> [{brandId, uid, alias, status}]` 负责旧链接回查。
- 品牌状态机：`pending → in-progress → ready / needs-review → confirmed`。

## 迁移流程（对应控制台 5 步）

1. **迁移前核对** `audit.ts`：汇总收藏、评审单、CSS 导出、发布快照四类单据的归属。
   - 全部指向同一品牌 → 归属确定；
   - 同一编号指向多个品牌 → `ownership-conflict`，每个品牌一方旧值（标题、别名、来源单据、单号）全部列出；
   - 无任何单据认领 → `unclaimed`，进工作室兜底空间 `__studio__`；
   - 单据/回执引用了不存在的编号 → 进 `orphans`，不阻塞其它品牌。
2. **执行迁移** `engine.runBrand / migrateAll`：以品牌为最小提交单元，单包写入。
   - 写入失败的品牌不落任何半成品（内存修改随失败丢弃）；
   - 已处于 `ready / needs-review / confirmed` 的品牌再次执行直接幂等跳过，不会重复改名、不会产生重复副本；
   - `retryPending` 只补未完成品牌。
   - 归属冲突编号：双方各落一份 `pending-review` 副本，旧值保留可对账；收藏标记按各品牌自己的收藏单还原。
3. **站点回执对账**：按「旧编号 + 别名」双条件核对。
   - 都一致 → `matched` 并写入落点 uid；
   - 别名不符、编号不存在、归属未决 → 一律停在 `pending`（原因分别为 `alias-mismatch / number-not-found / ownership-pending`）。
4. **旧链接回查** `resolveLegacyLink`：凭旧编号解析；跨品牌歧义时需带品牌参数（落到原品牌），别名不符不静默跳转，解析过程同样受品牌权限过滤。
5. **品牌空间 + 导出**：每个品牌独立空间；导出的 CSS 头同时含 `uid`（新编号）与 `legacy pairing no.`（旧编号）及别名，文件名为 `brand-uid.css`。

## 权限

- 工作室（`role: studio`）：执行/重试全量迁移、处理兜底空间、可见全部品牌。
- 品牌管理员：只能查看、访问、确认本品牌；不能执行迁移、不能确认其它品牌或兜底空间。确认动作记录确认人与时间（`confirmedBy / confirmedAt`）。

## 文件

- `types.ts` — 领域模型与权限错误
- `seed.ts` — 旧数据快照（含冲突 #5/#6、未认领 #8、孤儿单据 #99/#42、别名错回执 #2 等场景）
- `audit.ts` — 迁移前归属核对
- `storage.ts` — 持久化端口（浏览器 localStorage / 内存 + 可注入写入故障）
- `engine.ts` — 迁移、重试、对账、确认、旧链接、导出
- `MigrationConsole.tsx` — 可视化控制台（应用右上角「品牌隔离迁移」，或访问 `#/migration`）
- `run-tests.ts` — 9 项验证：`npm test`
- `smoke-ls.ts` — 跨「刷新页面」的 localStorage 持久化冒烟：`npm run smoke`
