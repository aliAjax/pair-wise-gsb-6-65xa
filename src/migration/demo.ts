import type { LegacySnapshot, StoredPair } from './types';

export const BRANDS = [
  { id: 'aurora', name: 'Aurora Coffee', color: '#e8b7a0' },
  { id: 'northwind', name: 'Northwind Outdoors', color: '#9fc9be' },
  { id: 'lumen', name: 'Lumen Labs', color: '#b4add8' },
] as const;

/** 旧时代混在一起的全局数据：编号跨品牌共用、回执抄写错误等真实脏数据 */
export function buildDemoLegacy(): LegacySnapshot {
  return {
    pairs: [
      { id: 1, title: 'Editorial calm', heading: 'A slower way to see', body: 'Good typography creates space for ideas to breathe.', category: 'Editorial', favorite: true },
      { id: 2, title: 'Studio notes', heading: 'Make room for the unexpected', body: 'A thoughtful pairing can add rhythm to even the simplest interface.', category: 'Portfolio', favorite: false },
      { id: 3, title: 'Field guide', heading: 'Small details, lasting impressions', body: 'Typography is the voice of a page.', category: 'Brand', favorite: false },
      { id: 4, title: 'Quiet confidence', heading: 'Strength does not shout', body: 'A restrained pairing lets the product speak first.', category: 'Brand', favorite: true },
      { id: 5, title: 'Orphan draft', heading: 'Where does this belong', body: 'Nobody ever stamped a brand on this one.', category: 'Untitled', favorite: false },
    ],
    assignments: [
      { pairId: 1, brand: 'aurora' },
      { pairId: 2, brand: 'northwind' },
      { pairId: 3, brand: 'aurora' },
      { pairId: 3, brand: 'lumen' }, // 同一编号 3 在登记表上指向两个品牌
      { pairId: 4, brand: 'lumen' },
    ],
    favorites: [
      { favId: 'fav-a1', pairId: 1, brand: 'aurora', savedAt: '2026-08-02T10:00:00Z', note: '主视觉' },
      { favId: 'fav-n2', pairId: 2, brand: 'northwind', savedAt: '2026-08-11T08:30:00Z' },
      { favId: 'fav-a3', pairId: 3, brand: 'aurora', savedAt: '2026-09-01T12:00:00Z' },
      { favId: 'fav-l3', pairId: 3, brand: 'lumen', savedAt: '2026-09-02T12:00:00Z', note: '双方都收藏过同一编号' },
      { favId: 'fav-l4', pairId: 4, brand: 'lumen', savedAt: '2026-09-05T09:10:00Z' },
    ],
    reviews: [
      { reviewId: 'rev-1', pairId: 1, brand: 'aurora', alias: 'pair-1', rating: 5, verdict: '通过', updatedAt: '2026-08-03T00:00:00Z' },
      { reviewId: 'rev-2', pairId: 2, brand: 'northwind', alias: 'pair-2', rating: 4, verdict: '微调字距', updatedAt: '2026-08-12T00:00:00Z' },
      { reviewId: 'rev-3a', pairId: 3, brand: 'aurora', alias: 'pair-3', rating: 5, verdict: 'Aurora 版通过', updatedAt: '2026-09-03T00:00:00Z' },
      { reviewId: 'rev-3l', pairId: 3, brand: 'lumen', alias: 'pair-3', rating: 3, verdict: 'Lumen 版要重做正文', updatedAt: '2026-09-04T00:00:00Z' },
      { reviewId: 'rev-4', pairId: 4, brand: 'lumen', alias: 'pair-4', rating: 5, verdict: '通过', updatedAt: '2026-09-06T00:00:00Z' },
    ],
    exports: [
      { exportId: 'exp-1', pairId: 1, brand: 'aurora', alias: 'pair-1', css: '.heading{font-family:Fraunces}', fileName: 'aurora-pair-1.css', exportedAt: '2026-08-04T10:00:00Z' },
      { exportId: 'exp-3a', pairId: 3, brand: 'aurora', alias: 'pair-3', css: '.heading{font-family:Playfair Display}', fileName: 'aurora-pair-3.css', exportedAt: '2026-09-03T10:00:00Z' },
      { exportId: 'exp-3l', pairId: 3, brand: 'lumen', alias: 'pair-3', css: '.heading{font-family:Space Grotesk}', fileName: 'lumen-pair-3.css', exportedAt: '2026-09-04T10:00:00Z' },
    ],
    receipts: [
      { receiptId: 'rcp-1', pairId: 1, alias: 'pair-1', site: 'aurora-www', receivedAt: '2026-08-04T10:01:00Z' },
      { receiptId: 'rcp-2', pairId: 2, alias: 'pair-2', site: 'northwind-cdn', receivedAt: '2026-08-13T10:01:00Z' },
      // 编号 4 的站点回执把别名抄成了 pair-404：编号 + 别名对不上 -> 停在待核
      { receiptId: 'rcp-4-bad', pairId: 4, alias: 'pair-404', site: 'lumen-deploy', receivedAt: '2026-09-07T10:01:00Z' },
      // 指向根本不存在的编号
      { receiptId: 'rcp-x', pairId: 99, alias: 'pair-99', site: 'unknown-edge', receivedAt: '2026-09-08T10:01:00Z' },
    ],
  };
}

export function emptyBrandSpace(): { pairs: StoredPair[] } {
  return { pairs: [] };
}
