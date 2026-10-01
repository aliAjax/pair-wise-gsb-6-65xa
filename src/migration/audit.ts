// 迁移前核对：收藏 / 评审单 / 已导出 CSS / 发布快照的归属
// 规则：
//  - 同一编号的所有单据 + 配对行内记录只指向一个品牌 → 归属确定；
//  - 指向多个品牌 → ownership-conflict，逐个品牌保留一方旧值，迁移时双方各落一份待核副本；
//  - 没有任何单据认领 → unclaimed，挂在工作室兜底空间，状态待核；
//  - 单据 / 回执指向不存在的编号 → 进 orphans，不阻塞其它品牌。
import type {AuditReport, BrandId, ClaimSource, LegacyClaim, LegacyPair, OrphanRecord, OwnerSide, PairAudit, SiteReceipt} from './types';

const FALLBACK_BRAND: BrandId = '__studio__';

interface SideBuilder extends OwnerSide {
  sourceSet: Set<ClaimSource>;
  refSet: Set<string>;
  latestAt: string;
}

function pushClaim(side: SideBuilder, claim: LegacyClaim) {
  side.sourceSet.add(claim.source);
  side.refSet.add(claim.ref);
  if (!side.alias) side.alias = claim.alias;
  if (claim.at >= side.latestAt) {
    side.latestAt = claim.at;
    if (claim.label) side.label = claim.label;
    if (claim.alias) side.alias = claim.alias;
  }
}

export interface AuditInput {
  pairs: LegacyPair[];
  claims: LegacyClaim[];
  receipts: SiteReceipt[];
}

export function runAudit(input: AuditInput): AuditReport {
  const {pairs, claims, receipts} = input;
  const pairMap = new Map(pairs.map((p) => [p.id, p]));
  const orphans: OrphanRecord[] = [];
  const brandPairIds: Record<BrandId, number[]> = {};
  const rememberBrand = (brandId: BrandId, pairId: number) => {
    (brandPairIds[brandId] ??= []).push(pairId);
  };

  const audits: PairAudit[] = pairs.map((legacy) => {
    const sidesByBrand = new Map<BrandId, SideBuilder>();

    const sideFor = (brandId: BrandId): SideBuilder => {
      let side = sidesByBrand.get(brandId);
      if (!side) {
        side = {brandId, sources: [], refs: [], sourceSet: new Set(), refSet: new Set(), latestAt: ''};
        sidesByBrand.set(brandId, side);
      }
      return side;
    };

    for (const claim of claims) {
      if (claim.pairId !== legacy.id) continue;
      if (!claim.brandId) continue; // 无品牌的单据不参与归属判定
      pushClaim(sideFor(claim.brandId), claim);
    }

    // 配对行内的 brandId 也是一方旧值（来源标记为「配对行」，sources 留空）
    if (legacy.brandId) {
      const side = sideFor(legacy.brandId);
      side.refSet.add(`配对行 brand=${legacy.brandId}`);
      if (legacy.alias) side.alias ??= legacy.alias;
    }

    const pairReceipts = receipts.filter((r) => r.pairId === legacy.id);
    const sides = [...sidesByBrand.values()].map((s) => ({
      brandId: s.brandId,
      sources: [...s.sourceSet],
      alias: s.alias,
      label: s.label,
      at: s.latestAt || undefined,
      refs: [...s.refSet],
    }));

    const candidateBrands = sides.map((s) => s.brandId);
    for (const brandId of candidateBrands) rememberBrand(brandId, legacy.id);

    const issues: PairAudit['issues'] = [];
    let ownerBrandId: BrandId | undefined;
    if (candidateBrands.length > 1) {
      issues.push('ownership-conflict');
    } else if (candidateBrands.length === 1) {
      ownerBrandId = candidateBrands[0];
    } else {
      issues.push('unclaimed');
      rememberBrand(FALLBACK_BRAND, legacy.id);
    }

    return {pairId: legacy.id, legacy, ownerBrandId, sides, issues, receipts: pairReceipts};
  });

  for (const claim of claims) {
    if (!pairMap.has(claim.pairId)) {
      orphans.push({kind: 'claim', pairId: claim.pairId, brandId: claim.brandId, ref: claim.ref});
    }
  }
  for (const receipt of receipts) {
    if (!pairMap.has(receipt.pairId)) {
      orphans.push({kind: 'receipt', pairId: receipt.pairId, brandId: receipt.brandId, ref: receipt.url});
    }
  }

  return {generatedAt: new Date().toISOString(), pairs: audits, orphans, brandPairIds};
}

export {FALLBACK_BRAND};
