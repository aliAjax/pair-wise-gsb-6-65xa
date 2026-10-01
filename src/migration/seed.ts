// 迁移起点的旧数据快照：
// 全部沿用历史上的全局编号；故意包含归属冲突、孤儿单据、回执对不上等情况，
// 以覆盖需求中的「列出双方旧值 / 对不上停在待核 / 只重试未完成品牌」。
import type {Brand, Identity, LegacyClaim, LegacyPair, SiteReceipt} from './types';

export const BRANDS: Brand[] = [
  {id: 'aurora', name: 'Aurora Coffee', color: '#e8b7a0', admins: ['u-yuki']},
  {id: 'northwind', name: 'Northwind Outdoor', color: '#9fc9be', admins: ['u-marcus']},
  {id: 'lumen', name: 'Lumen Studio', color: '#b4add8', admins: ['u-sora']},
];

export const IDENTITIES: Record<string, Identity> = {
  studio: {userId: 'u-studio', name: '工作室超管', role: 'studio'},
  'u-yuki': {userId: 'u-yuki', name: 'Yuki Lin', role: 'brand-admin', brands: ['aurora']},
  'u-marcus': {userId: 'u-marcus', name: 'Marcus Reed', role: 'brand-admin', brands: ['northwind']},
  'u-sora': {userId: 'u-sora', name: 'Sora Aoki', role: 'brand-admin', brands: ['lumen']},
};

export const LEGACY_PAIRS: LegacyPair[] = [
  {id: 1, title: 'Editorial calm', heading: 'A slower way to see', body: 'Good typography creates space.', category: 'Editorial', favorite: true, brandId: 'aurora', alias: 'editorial-calm'},
  {id: 2, title: 'Studio notes', heading: 'Make room for the unexpected', body: 'A thoughtful pairing can add rhythm.', category: 'Portfolio', favorite: false, brandId: 'aurora', alias: 'studio-notes'},
  {id: 3, title: 'Field guide', heading: 'Small details, lasting impressions', body: 'Typography is the voice of a page.', category: 'Brand', favorite: false, brandId: 'northwind', alias: 'field-guide'},
  // id 4：行内没有品牌，靠收藏/评审单据归属
  {id: 4, title: 'Quiet confidence', heading: 'Let the work breathe', body: 'Generous spacing and a steady rhythm.', category: 'Brand', favorite: true, alias: 'quiet-confidence'},
  // id 5：同一编号，收藏归 aurora、已导出 CSS 却挂在 lumen —— 双方旧值冲突
  {id: 5, title: 'Warm headlines', heading: 'Serve the story first', body: 'A display face earns its place.', category: 'Editorial', favorite: true, brandId: 'aurora', alias: 'warm-headlines'},
  // id 6：两品牌都发布过（发布快照冲突）
  {id: 6, title: 'Product notes', heading: 'Details people feel', body: 'Type that scales from label to page.', category: 'Product', favorite: false, brandId: 'northwind', alias: 'product-notes'},
  {id: 7, title: 'Poster voice', heading: 'Loud, but on purpose', body: 'Contrast is a decision, not a default.', category: 'Poster', favorite: false, brandId: 'lumen', alias: 'poster-voice'},
  // id 8：没有任何业务单据认领 —— 未认领
  {id: 8, title: 'Untitled sketch', heading: 'Draft heading', body: 'Draft body copy.', category: 'Untitled', favorite: false},
];

export const LEGACY_CLAIMS: LegacyClaim[] = [
  // aurora
  {source: 'favorite', pairId: 1, brandId: 'aurora', ref: 'FAV-201', label: 'Editorial calm', alias: 'editorial-calm', at: '2026-08-02T10:00:00Z'},
  {source: 'review', pairId: 2, brandId: 'aurora', ref: 'REV-117', label: 'Studio notes', alias: 'studio-notes', at: '2026-08-11T09:20:00Z'},
  {source: 'publish', pairId: 2, brandId: 'aurora', ref: 'PUB-330', label: 'Studio notes', alias: 'studio-notes', at: '2026-08-12T15:40:00Z'},
  {source: 'favorite', pairId: 4, brandId: 'aurora', ref: 'FAV-205', label: 'Quiet confidence', alias: 'quiet-confidence', at: '2026-08-21T14:05:00Z'},
  {source: 'review', pairId: 4, brandId: 'aurora', ref: 'REV-121', label: 'Quiet confidence', alias: 'quiet-confidence', at: '2026-08-22T11:00:00Z'},
  // id 5：aurora 侧
  {source: 'favorite', pairId: 5, brandId: 'aurora', ref: 'FAV-207', label: 'Warm headlines', alias: 'warm-headlines', at: '2026-08-25T08:10:00Z'},
  {source: 'review', pairId: 5, brandId: 'aurora', ref: 'REV-124', label: 'Warm headlines', alias: 'warm-headlines', at: '2026-08-26T08:10:00Z'},
  // id 5：lumen 侧（同编号、同别名，但 CSS 导出记成了 lumen 的客户）
  {source: 'css', pairId: 5, brandId: 'lumen', ref: 'css/warm-headlines.v3.css', label: 'Warm headlines (Lumen 客户导出)', alias: 'warm-headlines', at: '2026-09-01T17:30:00Z'},
  // northwind
  {source: 'favorite', pairId: 3, brandId: 'northwind', ref: 'FAV-118', label: 'Field guide', alias: 'field-guide', at: '2026-08-05T13:00:00Z'},
  {source: 'review', pairId: 3, brandId: 'northwind', ref: 'REV-109', label: 'Field guide', alias: 'field-guide', at: '2026-08-06T13:00:00Z'},
  {source: 'css', pairId: 3, brandId: 'northwind', ref: 'css/field-guide.css', label: 'Field guide', alias: 'field-guide', at: '2026-08-07T13:00:00Z'},
  {source: 'favorite', pairId: 6, brandId: 'northwind', ref: 'FAV-122', label: 'Product notes', alias: 'product-notes', at: '2026-09-02T10:00:00Z'},
  // id 6：lumen 也发布过 —— 发布快照冲突
  {source: 'publish', pairId: 6, brandId: 'northwind', ref: 'PUB-341', label: 'Product notes', alias: 'product-notes', at: '2026-09-03T10:00:00Z'},
  {source: 'publish', pairId: 6, brandId: 'lumen', ref: 'PUB-342', label: 'Product notes（Lumen 活动页）', alias: 'product-notes', at: '2026-09-04T10:00:00Z'},
  // lumen
  {source: 'favorite', pairId: 7, brandId: 'lumen', ref: 'FAV-130', label: 'Poster voice', alias: 'poster-voice', at: '2026-09-06T09:00:00Z'},
  {source: 'css', pairId: 7, brandId: 'lumen', ref: 'css/poster-voice.css', label: 'Poster voice', alias: 'poster-voice', at: '2026-09-07T09:00:00Z'},
  // 孤儿单据：指向已不存在的旧编号 99
  {source: 'review', pairId: 99, brandId: 'aurora', ref: 'REV-130', label: '已删除配对？', alias: 'missing-no-99', at: '2026-09-08T09:00:00Z'},
];

export const SITE_RECEIPTS: SiteReceipt[] = [
  // 编号 + 别名都对得上
  {pairId: 1, alias: 'editorial-calm', brandId: 'aurora', url: 'https://aurora.example.com/p/editorial-calm', at: '2026-08-13T10:00:00Z'},
  {pairId: 3, alias: 'field-guide', brandId: 'northwind', url: 'https://shop.northwind.example.com/type/field-guide', at: '2026-08-13T11:00:00Z'},
  {pairId: 7, alias: 'poster-voice', brandId: 'lumen', url: 'https://lumen.example.com/posters/poster-voice', at: '2026-09-08T10:00:00Z'},
  // 站点把别名回传错了：编号 2，别名却不是 studio-notes
  {pairId: 2, alias: 'studio-notes-v2', brandId: 'aurora', url: 'https://aurora.example.com/p/studio-notes-v2', at: '2026-08-13T12:00:00Z'},
  // 回执编号在配对库里根本不存在
  {pairId: 42, alias: 'ghost-pair', brandId: 'lumen', url: 'https://lumen.example.com/x/ghost-pair', at: '2026-09-09T10:00:00Z'},
  // 编号 6 归属有争议：先不自动对，等人工核
  {pairId: 6, alias: 'product-notes', brandId: 'northwind', url: 'https://shop.northwind.example.com/type/product-notes', at: '2026-09-05T10:00:00Z'},
];
