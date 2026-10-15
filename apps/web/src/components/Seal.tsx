/**
 * 달빛사주 로고 — 황금 초승달(원본: image/달빛사주_ 황금 초승달 로고.png).
 * public/brand/* 는 원본의 남색 바탕을 걷어 낸 그림이라 남색 위에서만 또렷하다.
 * 그래서 밤하늘 테마는 투명 초승달 + 금빛 붓글씨, 밝은 화면은 남색 앱 아이콘 + 남색 글자로 쓴다.
 * night: 늘 남색 위(밤하늘 패널)에 놓일 때 — 테마와 상관없이 금빛 로고
 */
export function Wordmark({ night = false }: { night?: boolean }) {
  const dark = night ? 'block' : 'hidden dark:block';
  const light = night ? 'hidden' : 'dark:hidden';
  return (
    <span className="inline-flex items-center gap-1.5">
      <img src="/brand/mark.webp" alt="" width={44} height={32} className={`h-8 w-auto ${dark}`} />
      <img src="/icon-192.png" alt="" width={30} height={30} className={`size-[30px] rounded-lg ${light}`} />
      <img src="/brand/word.webp" alt="달빛사주" width={78} height={24} className={`h-6 w-auto ${dark}`} />
      <span className={`font-serif text-lg font-semibold tracking-tight ${light}`}>달빛사주</span>
    </span>
  );
}

/** 첫 화면·로그인 화면의 큰 초승달 — 남색 바탕(.night-sky) 위에 둔다 */
export function MoonEmblem({ className }: { className?: string }) {
  return <img src="/brand/emblem.webp" alt="" width={640} height={464} fetchPriority="high" className={className} />;
}
