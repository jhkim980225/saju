/**
 * 간지 한자 → 읽는 법·쉬운 이름 (만세력 화면용).
 * 서버 plainFortune.yearNickname 과 같은 규칙: 천간 색 + 지지 띠 → 己卯 '누런 토끼의 해'
 */
const STEM: Record<string, { ko: string; color: string }> = {
  甲: { ko: '갑', color: '푸른' },
  乙: { ko: '을', color: '푸른' },
  丙: { ko: '병', color: '붉은' },
  丁: { ko: '정', color: '붉은' },
  戊: { ko: '무', color: '누런' },
  己: { ko: '기', color: '누런' },
  庚: { ko: '경', color: '흰' },
  辛: { ko: '신', color: '흰' },
  壬: { ko: '임', color: '검은' },
  癸: { ko: '계', color: '검은' },
};
const BRANCH: Record<string, { ko: string; animal: string }> = {
  子: { ko: '자', animal: '쥐' },
  丑: { ko: '축', animal: '소' },
  寅: { ko: '인', animal: '호랑이' },
  卯: { ko: '묘', animal: '토끼' },
  辰: { ko: '진', animal: '용' },
  巳: { ko: '사', animal: '뱀' },
  午: { ko: '오', animal: '말' },
  未: { ko: '미', animal: '양' },
  申: { ko: '신', animal: '원숭이' },
  酉: { ko: '유', animal: '닭' },
  戌: { ko: '술', animal: '개' },
  亥: { ko: '해', animal: '돼지' },
};

/** '己卯' → '기묘' (모르는 글자는 그대로) */
export function ganzhiKo(hanja: string): string {
  const [s, b] = [...hanja];
  return `${STEM[s ?? '']?.ko ?? s ?? ''}${BRANCH[b ?? '']?.ko ?? b ?? ''}`;
}

/** '己卯' → '누런 토끼의 해' — 모르면 빈 문자열 */
export function yearNickname(hanja: string): string {
  const [s, b] = [...hanja];
  const stem = STEM[s ?? ''];
  const branch = BRANCH[b ?? ''];
  return stem && branch ? `${stem.color} ${branch.animal}의 해` : '';
}
