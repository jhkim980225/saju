/**
 * 문구 리소스 — 홍보팀 카피 가이드(docs/research/copy-ko.json)를 그대로 사용한다.
 * t('result.title', { name: '서윤' }) → '서윤님의 사주'
 */
import ko from '../i18n/ko.json';

type Dict = { [k: string]: string | Dict };
const dict = ko as Dict;

export function t(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = node[part];
  }
  if (typeof node !== 'string') return key;
  if (!vars) return node;
  return node.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`));
}

export const BRAND = {
  name: t('brand.name'),
  hanja: t('brand.nameHanja'),
  slogan: t('brand.slogan'),
  tagline: t('brand.tagline'),
};
