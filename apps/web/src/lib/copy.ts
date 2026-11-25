/**
 * 문구 리소스 — 홍보팀 카피 가이드(docs/research/copy-ko.json)를 그대로 사용한다.
 * t('result.title', { name: '서윤' }) → '서윤님의 사주'
 */
import ko from '../i18n/ko.json';
import { IS_TOSS } from './platform';

type Dict = { [k: string]: string | Dict };
const dict = ko as Dict;
const ME = (ko as { common: { me: string } }).common.me;

export function t(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = node[part];
  }
  if (typeof node !== 'string') return key;
  // 토스 미니앱: 대화상자의 왼쪽(닫는) 버튼은 '닫기'로 쓴다(앱인토스 UX 가이드)
  if (IS_TOSS && key === 'common.cancel') return '닫기';
  if (!vars) return node;
  // 이름이 없거나 '나'(이름 없이 저장한 본인)이면 '나님의 사주' 대신 '나의 사주'처럼 높임 없이 쓴다
  if ('name' in vars) {
    const n = String(vars.name ?? '').trim();
    if (n === '' || n === ME) {
      node = node
        .replace(/\{\{name\}\}님의/g, '나의')
        .replace(/\{\{name\}\}님과/g, '나와')
        .replace(/\{\{name\}\}님은/g, '나는')
        .replace(/\{\{name\}\}님, /g, '')
        .replace(/\{\{name\}\}님/g, '나');
    }
  }
  return node.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`));
}

export const BRAND = {
  name: t('brand.name'),
  slogan: t('brand.slogan'),
  tagline: t('brand.tagline'),
};

/** 이름 높임 — 이름이 없거나 '나'이면 높이지 않는다. '서윤님' / '나' */
export const honorName = (name?: string | null): string => {
  const n = (name ?? '').trim();
  return n === '' || n === ME ? ME : `${n}님`;
};
/** 소유격 — '서윤님의' / '나의' */
export const honorOf = (name?: string | null): string => `${honorName(name)}의`;
