import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { todayKst } from '@/lib/format';
import { useSession } from '@/lib/session';
import { TarotCardBack, TarotCardFace, orientationLabel } from './TarotCard';
import { Card } from './ui';

/** 오늘 탭의 '오늘의 카드' 모듈 — 사주 '오늘의 한 줄'과 출처가 다르다는 걸 라벨로 구분한다 */
export function TodayTarotCard() {
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.accessToken);
  const history = useQuery({ queryKey: ['tarot', 'history', user?.id ?? 'anon'], queryFn: api.tarotHistory, enabled: Boolean(token), staleTime: 60_000 });
  const today = todayKst().iso;
  const daily = history.data?.find((h) => h.spread === 'daily' && h.date === today);
  const card = daily?.cards[0];
  return (
    <Card className="mt-4">
      <p className="text-sm font-semibold text-ink-3">{t('tarot.home.dailyCard.label')}</p>
      <div className="mt-3 flex items-center gap-4">
        {card ? <TarotCardFace card={{ ...card, imagery: '' }} className="w-16 shrink-0" /> : <TarotCardBack className="w-16 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-serif text-lg font-semibold">{card ? `${card.nameKo} · ${orientationLabel(card.orientation)}` : t('tarot.home.dailyCard.title')}</p>
          <p className="mt-0.5 text-sm text-ink-2">{card ? t('tarot.home.dailyCard.oncePerDay') : t('tarot.home.dailyCard.desc')}</p>
          <Link to={card ? '/tarot/daily?open=1' : '/tarot/daily'} className="mt-2 inline-flex h-10 items-center rounded-full bg-action-2 px-4 text-sm font-semibold">
            {card ? t('tarot.home.dailyCard.viewCta') : t('tarot.home.dailyCard.cta')}
          </Link>
        </div>
      </div>
    </Card>
  );
}
