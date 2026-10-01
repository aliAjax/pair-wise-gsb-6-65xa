import { KEYS, KVPort, readJSON } from './storage';
import type {
  BrandAssignment,
  LegacyExportRow,
  LegacyFavoriteRow,
  LegacyPair,
  LegacyReviewRow,
  SiteReceiptRow,
} from './types';

/** 旧时代的正式（规范）别名：pair-{全局编号} */
export const canonicalAlias = (pairId: number) => `pair-${pairId}`;

/** 旧链接里可能出现的裸编号形式 /#/pair/N、N 或别名 */
export function parseLegacyRef(ref: string): { id: number; alias: string } | null {
  const t = ref.trim().replace(/^#\/?/, '').replace(/^pair\//, '');
  if (/^\d+$/.test(t)) {
    const id = Number(t);
    return Number.isFinite(id) ? { id, alias: canonicalAlias(id) } : null;
  }
  const m = /^pair-(\d+)$/.exec(t);
  if (m) return { id: Number(m[1]), alias: t };
  const ns = /^brand:[^:]+:pair-(\d+)$/.exec(t);
  if (ns) return { id: Number(ns[1]), alias: t };
  return null;
}

export function loadLegacySnapshot(kv: KVPort) {
  return {
    pairs: readJSON<LegacyPair[]>(kv, KEYS.legacyPairs, []),
    assignments: readJSON<BrandAssignment[]>(kv, KEYS.legacyAssignment, []),
    favorites: readJSON<LegacyFavoriteRow[]>(kv, KEYS.legacyFavorites, []),
    reviews: readJSON<LegacyReviewRow[]>(kv, KEYS.legacyReviews, []),
    exports: readJSON<LegacyExportRow[]>(kv, KEYS.legacyExports, []),
    receipts: readJSON<SiteReceiptRow[]>(kv, KEYS.siteReceipts, []),
  };
}
