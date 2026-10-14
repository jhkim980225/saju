import { GWAE_1 } from './gwae1.js';
import { GWAE_2 } from './gwae2.js';
import { GWAE_3 } from './gwae3.js';
import { GWAE_4 } from './gwae4.js';
import { GWAE_5 } from './gwae5.js';
import { GWAE_6 } from './gwae6.js';
import { GWAE_7 } from './gwae7.js';
import { GWAE_8 } from './gwae8.js';
import type { TojeongGwaeContent } from './types.js';

export * from './types.js';

/** 144괘 — 괘 번호 순서(111, 112, 113, 121 … 863) */
export const GWAE_LIST: readonly TojeongGwaeContent[] = [...GWAE_1, ...GWAE_2, ...GWAE_3, ...GWAE_4, ...GWAE_5, ...GWAE_6, ...GWAE_7, ...GWAE_8];

const BY_CODE = new Map(GWAE_LIST.map((g) => [g.code, g]));

export function gwaeOf(code: number): TojeongGwaeContent {
  const g = BY_CODE.get(code);
  if (!g) throw new Error(`토정비결 ${code}괘 원고가 없어요.`);
  return g;
}
