/**
 * 말투 — 비유·관용구·감성 문구가 없는지 콘텐츠 파일을 훑는다 (docs/PLAIN_KOREAN.md '말투').
 * 화면 글은 거의 모두 콘텐츠 파일의 문자열에서 오므로, 생성기를 돌리지 않고 원본 문자열을 직접 본다(잘 안 나오는 분기도 빠짐없이).
 * - 타로 카드 그림 설명(imagery)은 그림을 그대로 묘사하는 자리라 뺀다.
 * - 토정비결 총평의 첫 문장("…괘예요")은 옛 글귀가 그리는 장면이라 뺀다.
 * - 꿈해몽 사전은 꿈에 나온 사물(꽃·보물·무지개…)이 실제 낱말이라 여기서 보지 않는다.
 * - 한 줄을 꼭 남겨야 하면 그 줄 끝에 `// 말투 예외: 이유`를 단다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { figurativeProblems } from '../src/modules/interpretation/plainGuard.js';

const ROOT = path.resolve(__dirname, '../../..');
const AREAS: Record<string, string[]> = {
  '오늘·신년·궁합·무료 풀이': [
    'apps/api/src/modules/interpretation/content/fortuneTemplates.ts',
    'apps/api/src/modules/interpretation/content/plainFortune.ts',
    'apps/api/src/modules/interpretation/content/plain.ts',
    'apps/api/src/modules/interpretation/content/elements.ts',
    'apps/api/src/modules/interpretation/content/strength.ts',
    'apps/api/src/modules/interpretation/content/yongsin.ts',
    'apps/api/src/modules/interpretation/content/stages.ts',
    'apps/api/src/modules/interpretation/content/shinsal.ts',
    'apps/api/src/modules/interpretation/content/tenGods.ts',
    'apps/api/src/modules/interpretation/content/dayMasters.ts',
    'apps/api/src/modules/interpretation/reading.ts',
  ],
  '60일주·사주분석서·신년·궁합 리포트': [
    'apps/api/src/modules/interpretation/content/dayPillars.ts',
    'apps/api/src/modules/interpretation/content/luck.ts',
    'apps/api/src/modules/interpretation/content/reportPlain.ts',
    'apps/api/src/modules/interpretation/content/reportMisc.ts',
    'apps/api/src/modules/interpretation/report.ts',
  ],
  '연애·결혼운 · 재물·직업운 리포트': [
    'apps/api/src/modules/interpretation/content/loveReport.ts',
    'apps/api/src/modules/interpretation/content/careerWealthReport.ts',
    'apps/api/src/modules/interpretation/loveReport.ts',
    'apps/api/src/modules/interpretation/careerWealthReport.ts',
    'apps/api/src/modules/interpretation/topicReportKit.ts',
  ],
  '타로·띠·별자리·택일': ['apps/api/src/modules/tarot', 'apps/api/src/modules/zodiac', 'apps/api/src/modules/taekil', 'apps/web/src/i18n/ko.json'],
  '토정비결 1~4': ['apps/api/src/modules/tojeong/content/gwae1.ts', 'apps/api/src/modules/tojeong/content/gwae2.ts', 'apps/api/src/modules/tojeong/content/gwae3.ts', 'apps/api/src/modules/tojeong/content/gwae4.ts'],
  '토정비결 5~8': [
    'apps/api/src/modules/tojeong/content/gwae5.ts',
    'apps/api/src/modules/tojeong/content/gwae6.ts',
    'apps/api/src/modules/tojeong/content/gwae7.ts',
    'apps/api/src/modules/tojeong/content/gwae8.ts',
    'apps/api/src/modules/tojeong/service.ts',
  ],
};

function filesOf(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs.readdirSync(abs, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(ts|json)$/.test(f)).map((f) => path.join(abs, f));
}

/** 줄마다 문자열 속 비유를 찾는다 — 주석 줄·그림 설명·옛 글귀 장면·예외 표시는 뺀다 */
function scan(file: string): string[] {
  const out: string[] = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || /imagery\s*:/.test(t) || /\/\/ 말투 예외:/.test(t)) continue;
    const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => !/괘예요\.?['"`,]*$/.test(s));
    for (const s of sentences) for (const f of figurativeProblems(s)) out.push(`${path.relative(ROOT, file)}:${i + 1} '${f}' — ${t.slice(0, 120)}`);
  }
  return out;
}

describe('말투 — 비유·관용구·감성 문구 없이 차분하게', () => {
  for (const [area, rels] of Object.entries(AREAS)) {
    it(area, () => {
      const files = rels.flatMap(filesOf);
      expect(files.length, area).toBeGreaterThan(0);
      const problems = files.flatMap(scan);
      expect(problems.length, problems.slice(0, 40).join('\n')).toBe(0);
    });
  }
});
