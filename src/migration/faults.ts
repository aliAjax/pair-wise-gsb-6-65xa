import type { BrandId } from './types';
import type { MigrateDeps } from './migrate';
import type { KVPort } from './storage';

/**
 * 故障注入提交器：对 failBrands 中的品牌，在 failAtOp 次提交时抛出，
 * 用于验证“写入失败只重试未完成品牌、已迁好的品牌不重复改名”。
 * 非故障品牌正常执行（内存 apply 随后由执行器整体落盘）。
 */
export function makeCommit(opts?: {
  failBrands?: BrandId[];
  failAtOp?: number; // 每个故障品牌的第几次改名失败（默认 1）
  onOp?: (brand: BrandId, opId: string) => void;
}): MigrateDeps['commit'] {
  const counters = new Map<string, number>();
  const failBrands = new Set(opts?.failBrands ?? []);
  const failAtOp = opts?.failAtOp ?? 1;
  return (brand, opId, apply) => {
    if (failBrands.has(brand)) {
      const n = (counters.get(brand) ?? 0) + 1;
      counters.set(brand, n);
      if (n === failAtOp) {
        throw new Error(`模拟写入故障：品牌 ${brand} 第 ${n} 次改名（${opId}）落盘失败`);
      }
    }
    apply();
    opts?.onOp?.(brand, opId);
  };
}

export function makeDeps(kv: KVPort, commit?: MigrateDeps['commit']): MigrateDeps {
  return { kv, commit: commit ?? makeCommit(), delay: () => Promise.resolve() };
}
