import type {
  AuditReport,
  ConflictDecision,
  ConflictDecisions,
  MigrationPlan,
  PendingPair,
  PlannedRecord,
} from './types';

/**
 * 审计报告 + 人工裁决 -> 可执行迁移计划。
 * 裁决必须与冲突双方相符；receipt-blocked / unclaimed 的编号一律留在待核，
 * 不进计划（回执补正或品牌认领后重新生成计划即可）。
 */
export function buildPlan(audit: AuditReport, decisions: ConflictDecisions = {}): MigrationPlan {
  const entries: PlannedRecord[] = [];
  const pending: PendingPair[] = [];

  Object.values(audit.pairs)
    .sort((a, b) => a.pairId - b.pairId)
    .forEach((a) => {
      if (a.verdict === 'migratable') {
        entries.push({ pairId: a.pairId, brand: a.brands[0], fork: false, keepBareAlias: true });
        return;
      }
      if (a.verdict === 'conflict') {
        const decision: ConflictDecision | undefined = decisions[a.pairId];
        if (!decision) {
          pending.push({ pairId: a.pairId, reason: a.reason });
          return;
        }
        if (decision.kind === 'assign') {
          if (!a.brands.includes(decision.brand)) {
            pending.push({
              pairId: a.pairId,
              reason: `裁决目标品牌 ${decision.brand} 不在冲突方（${a.brands.join('、')}）之内，驳回`,
            });
            return;
          }
          entries.push({
            pairId: a.pairId,
            brand: decision.brand,
            fork: false,
            keepBareAlias: true,
          });
        } else {
          a.brands.forEach((brand, i) => {
            entries.push({
              pairId: a.pairId,
              brand,
              fork: true,
              // 旧裸别名落到冲突裁决顺序中的第一方，其余方走命名空间别名
              keepBareAlias: i === 0,
            });
          });
        }
        return;
      }
      pending.push({ pairId: a.pairId, reason: a.reason });
    });

  audit.orphanReceipts.forEach((r) => {
    if (!pending.some((p) => p.pairId === r.pairId)) {
      pending.push({ pairId: r.pairId, reason: r.detail });
    }
  });

  return { entries, pending };
}
