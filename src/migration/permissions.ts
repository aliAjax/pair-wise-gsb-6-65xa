import type { BrandId } from './types';

/* 品牌间数据访问权限隔离 */

export type Role = 'studio-admin' | 'brand-admin' | 'brand-member';

export interface Actor {
  id: string;
  name: string;
  role: Role;
  brand?: BrandId; // brand-admin / brand-member 所属品牌
}

export interface ConfirmResult {
  ok: boolean;
  reason?: string;
}

/** 能否读取某品牌空间 */
export function canReadBrand(actor: Actor, brand: BrandId): boolean {
  if (actor.role === 'studio-admin') return true;
  return actor.brand === brand;
}

/** 品牌管理员只能确认本品牌迁移；工作室管理员可确认任一品牌 */
export function canConfirmBrand(actor: Actor, brand: BrandId): ConfirmResult {
  if (actor.role === 'studio-admin') return { ok: true };
  if (actor.role === 'brand-admin') {
    return actor.brand === brand
      ? { ok: true }
      : { ok: false, reason: `品牌管理员只能确认本品牌（${actor.brand}），不能确认 ${brand}` };
  }
  return { ok: false, reason: '品牌成员无权确认迁移' };
}

/** 跨品牌冲突裁决只属于工作室管理员（涉及双方旧值） */
export function canResolveConflict(actor: Actor): ConfirmResult {
  return actor.role === 'studio-admin'
    ? { ok: true }
    : { ok: false, reason: '同一编号指向多个品牌的裁决需要工作室管理员权限' };
}

/** 触发/重试迁移：管理员可；brand-admin 仅限自己品牌 */
export function canMigrateBrand(actor: Actor, brand: BrandId): ConfirmResult {
  if (actor.role === 'studio-admin') return { ok: true };
  if (actor.role === 'brand-admin') {
    return actor.brand === brand
      ? { ok: true }
      : { ok: false, reason: `只能重跑本品牌（${actor.brand}），${brand} 无权访问` };
  }
  return { ok: false, reason: '品牌成员无权执行迁移' };
}
