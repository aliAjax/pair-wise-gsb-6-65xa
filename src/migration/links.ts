import { brandKey, KEYS, readJSON, type KVPort } from './storage';
import { parseLegacyRef } from './legacy';
import { canReadBrand, type Actor } from './permissions';
import type {
  AliasEntry,
  BrandId,
  LinkResolution,
  StoredExport,
  StoredFavorite,
  StoredPair,
  StoredReview,
} from './types';

export interface BrandSpace {
  pairs: StoredPair[];
  favorites: StoredFavorite[];
  reviews: StoredReview[];
  exports: StoredExport[];
}

/** 读取品牌空间：品牌间数据访问隔离，无权直接拒绝 */
export function loadBrandSpace(actor: Actor, brand: BrandId, kv: KVPort): BrandSpace | { forbidden: string } {
  if (!canReadBrand(actor, brand)) {
    return { forbidden: `无权访问品牌 ${brand} 的空间` };
  }
  return {
    pairs: readJSON<StoredPair[]>(kv, brandKey(brand, 'pairs'), []),
    favorites: readJSON<StoredFavorite[]>(kv, brandKey(brand, 'favorites'), []),
    reviews: readJSON<StoredReview[]>(kv, brandKey(brand, 'reviews'), []),
    exports: readJSON<StoredExport[]>(kv, brandKey(brand, 'exports'), []),
  };
}

/** 工作室级只读（审计/迁移控制台使用），不经过品牌权限 */
export function peekBrandSpace(brand: BrandId, kv: KVPort): BrandSpace {
  return {
    pairs: readJSON<StoredPair[]>(kv, brandKey(brand, 'pairs'), []),
    favorites: readJSON<StoredFavorite[]>(kv, brandKey(brand, 'favorites'), []),
    reviews: readJSON<StoredReview[]>(kv, brandKey(brand, 'reviews'), []),
    exports: readJSON<StoredExport[]>(kv, brandKey(brand, 'exports'), []),
  };
}

/**
 * 旧链接解析：#/pair/N、#/N、#/pair-N、命名空间别名，
 * 以及迁移后的品牌内编号（brand/B/local-N）都落到原品牌记录上。
 * 双方并存时旧裸别名 -> 消歧页。无权访问目标品牌 -> forbidden。
 */
export function resolveLink(actor: Actor, rawRef: string, kv: KVPort): LinkResolution {
  const ref = decodeURIComponent(rawRef.trim());
  const aliases = readJSON<AliasEntry[]>(kv, KEYS.aliasIndex, []);

  // 新路由：brand/{brand}/local-{id}
  const local = /^brand\/([^/]+)\/local-(\d+)$/.exec(ref);
  if (local) {
    const brand = local[1];
    const localId = Number(local[2]);
    if (!canReadBrand(actor, brand)) return { outcome: 'forbidden', brand, localId, ref };
    const p = peekBrandSpace(brand, kv).pairs.find((x) => x.localId === localId);
    return p
      ? { outcome: 'resolved', brand, localId: p.localId, uid: p.uid, legacyId: p.legacyId, via: 'new-route' }
      : { outcome: 'not-found', ref };
  }

  // 先按别名精确查（pair-N、brand:B:pair-N）
  const hit = aliases.find((a) => a.alias === ref);
  if (hit) return resolveAliasEntry(actor, hit, ref, kv);

  // 裸编号 / 旧别名形式
  const parsed = parseLegacyRef(ref);
  if (parsed) {
    const byLegacy = aliases.find((a) => a.alias === parsed.alias);
    if (byLegacy) return resolveAliasEntry(actor, byLegacy, ref, kv);
    // 迁移前或未收录：回退扫描品牌空间里的 legacyId（旧链接仍可打开的最后兜底）
    const fallback = findByLegacyId(actor, parsed.id, kv);
    return fallback ?? { outcome: 'not-found', ref };
  }

  return { outcome: 'not-found', ref };
}

function resolveAliasEntry(actor: Actor, entry: AliasEntry, ref: string, kv: KVPort): LinkResolution {
  if (entry.kind === 'disambiguation' && entry.candidates?.length) {
    const visible = entry.candidates.filter((c) => canReadBrand(actor, c.brand));
    if (visible.length === 1) {
      return {
        outcome: 'resolved',
        brand: visible[0].brand,
        localId: visible[0].localId,
        uid: visible[0].uid,
        legacyId: entry.legacyId,
        via: 'disambiguation-single',
      };
    }
    return { outcome: 'disambiguation', legacyId: entry.legacyId, candidates: visible };
  }
  if (entry.brand && entry.localId != null && entry.uid) {
    if (!canReadBrand(actor, entry.brand)) {
      return { outcome: 'forbidden', brand: entry.brand, localId: entry.localId, ref };
    }
    return {
      outcome: 'resolved',
      brand: entry.brand,
      localId: entry.localId,
      uid: entry.uid,
      legacyId: entry.legacyId,
      via: `alias:${entry.alias}`,
    };
  }
  return { outcome: 'not-found', ref };
}

function findByLegacyId(actor: Actor, legacyId: number, kv: KVPort): LinkResolution | null {
  const hits: { brand: BrandId; localId: number; uid: string }[] = [];
  const brands = new Set<string>();
  kv.keys().forEach((k) => {
    const m = /^brand:([^:]+):pairs$/.exec(k);
    if (m) brands.add(m[1]);
  });
  for (const brand of brands) {
    if (!canReadBrand(actor, brand)) continue;
    const p = peekBrandSpace(brand, kv).pairs.find((x) => x.legacyId === legacyId);
    if (p) hits.push({ brand, localId: p.localId, uid: p.uid });
  }
  if (hits.length === 1) {
    return { ...hits[0], outcome: 'resolved', legacyId, via: 'legacy-scan' } as LinkResolution;
  }
  if (hits.length > 1) return { outcome: 'disambiguation', legacyId, candidates: hits };
  return null;
}

/** 导出 CSS 同时保留新旧编号（别名 + legacyId 都写进头注释） */
export function buildDualIdCss(pair: StoredPair, tune?: {
  headingFont?: string;
  bodyFont?: string;
  size?: number;
  weight?: number;
  leading?: number;
  tracking?: number;
}): string {
  const heading = tune?.headingFont ?? 'Fraunces';
  const body = tune?.bodyFont ?? 'DM Sans';
  const size = tune?.size ?? 46;
  const weight = tune?.weight ?? 600;
  const leading = tune?.leading ?? 1.25;
  const tracking = tune?.tracking ?? 0;
  return [
    `/* ${pair.title}`,
    ` * 新编号（品牌空间）: #${pair.localId}  别名 ${pair.alias}`,
    ` * 旧编号（全局配对库）: #${pair.legacyId ?? '-'}  旧别名 ${pair.legacyAlias ?? '-'}`,
    ` * 旧链接仍可打开：#/pair/${pair.legacyId ?? pair.localId}`,
    ` */`,
    `.heading { font-family: '${heading}'; font-size: ${size}px; font-weight: ${weight}; }`,
    `.body { font-family: '${body}'; line-height: ${leading}; letter-spacing: ${tracking}px; }`,
    `/* legacy-id: ${pair.legacyId ?? ''} | current-id: ${pair.localId} | alias: ${pair.alias} */`,
  ].join('\n');
}
