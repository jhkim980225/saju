import { Card, cx } from './ui';

/**
 * 맨 위 요약 카드 — 사주를 몰라도 10초 안에 결론을 알 수 있게 한 줄씩(docs/PLAIN_KOREAN.md '화면 구조').
 * 결과 화면 '한눈에 보는 나'와 같은 모양으로 오늘·신년운세에서 쓴다.
 */
export function KeyPointsCard({ title, items, className, level = 2 }: { title: string; items: { label: string; text: string }[]; className?: string; level?: 2 | 3 }) {
  if (items.length === 0) return null;
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <Card className={cx('mt-5', className)}>
      <Heading className="font-semibold">{title}</Heading>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[15px] leading-relaxed">
        {items.map((k) => (
          <div key={k.label} className="contents">
            <dt className="text-ink-3">{k.label}</dt>
            <dd className="text-ink">{k.text}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
