/**
 * 바텀시트 ↔ 브라우저 히스토리 (토스 빌드 전용) — components/BottomSheet 가 lib/tossBridge 를 거쳐 쓴다.
 *
 * 토스 내비게이션 바의 뒤로가기(와 안드로이드 뒤로가기)는 브라우저 히스토리를 한 칸 되돌린다.
 * 시트가 열릴 때 히스토리를 한 칸 쌓아 두면, 뒤로가기를 눌렀을 때 화면은 그대로 두고 시트만 닫을 수 있다.
 *
 *  - 열림: 지금 항목의 state 를 복사해 표식(ydSheet)을 붙여 pushState 한다. 주소는 바꾸지 않는다.
 *  - 뒤로가기: 표식이 붙은 항목에서 벗어나면 맨 위 시트의 onClose 를 부른다. 주소가 같으므로 라우터에는 알리지 않는다.
 *  - 화면에서 닫음(X·배경·버튼): 쌓아 둔 한 칸을 history.back() 으로 되돌린다. 이 pop 도 라우터에 알리지 않는다.
 *  - 시트 안에서 다른 화면으로 이동해 시트 항목이 남은 경우: 나중에 그 항목에 돌아오면 한 칸 더 되돌려 건너뛴다.
 *  - 시트 안에서 같은 화면의 주소만 바꾼(replace) 경우: 닫을 때 아래 항목으로 내려가 새 주소를 덮어써서 한 칸으로 합친다.
 *
 * 첫 화면(탭)에서는 히스토리가 한 칸뿐이므로, 시트를 닫은 뒤 뒤로가기를 누르면 그대로 미니앱이 종료된다.
 * 열고 닫는 처리는 다음 틱에 한꺼번에 맞춘다(개발 모드 StrictMode 의 이펙트 두 번 실행, 닫자마자 다른 시트 열기에 안전하게).
 */
import { useEffect, useRef } from 'react';

const MARK = 'ydSheet';

interface SheetRecord {
  id: string;
  onClose: () => void;
  /** 히스토리에 한 칸을 쌓았는가 */
  pushed: boolean;
  /** 쌓을 때의 주소와 라우터 색인 — 시트 안에서 주소가 바뀌었는지 가린다 */
  href: string;
  idx: unknown;
  /** 뒤로가기로 이미 항목에서 벗어났다(되돌릴 칸이 없다) */
  popped: boolean;
}

type HistoryState = Record<string, unknown> | null;
const stateNow = (): HistoryState => (window.history.state ?? null) as HistoryState;
const markerOf = (s: HistoryState): string | undefined => (s && typeof s[MARK] === 'string' ? (s[MARK] as string) : undefined);

let seq = 0;
/** 열려 있는 시트(아래 → 위) */
const open: SheetRecord[] = [];
/** 닫혀서 히스토리 정리를 기다리는 시트 */
const closing: SheetRecord[] = [];
/** 우리가 부른 history.back() — 벗어나려던 시트의 id (합치기는 null) */
const selfPops: (string | null)[] = [];
/** 라우터에 알리지 않을 pop 수(우리가 부른 forward) */
let hiddenPops = 0;
/** 아래 항목으로 내려간 뒤 덮어쓸 주소(시트 안에서 주소만 바뀐 경우) */
let collapse: { state: HistoryState; url: string } | null = null;
let scheduled = false;
let installed = false;

const hide = (e: Event) => e.stopImmediatePropagation();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    reconcile();
  });
}

/** 열린 시트와 히스토리를 맞춘다 */
function reconcile() {
  // 되돌리는 중이면 pop 이 끝난 뒤(onPop)에 다시 맞춘다 — 그 전에 쌓으면 방금 쌓은 칸이 되돌려진다
  if (selfPops.length > 0 || hiddenPops > 0) return;
  while (closing.length > 0) {
    const s = stateNow();
    const marker = markerOf(s);
    // 지금 항목의 주인인 시트부터 되돌린다(겹친 시트가 한꺼번에 닫혀도 위에서부터 한 칸씩)
    const own = closing.findIndex((r) => r.id === marker);
    if (own >= 0) {
      const [done] = closing.splice(own, 1);
      selfPops.push(done!.id);
      window.history.back();
      return;
    }
    const done = closing.shift()!;
    if (!marker && done.idx !== undefined && s?.idx === done.idx) {
      // 시트 안에서 주소만 바뀌었다(라우터의 replace 가 표식을 지웠다) → 아래 항목과 합친다
      collapse = { state: s, url: window.location.href };
      selfPops.push(null);
      window.history.back();
      return;
    }
    // 그 밖(시트 안에서 다른 화면으로 이동)은 항목을 그대로 둔다 — 나중에 돌아오면 onPop 이 건너뛴다
  }
  for (const rec of open) {
    if (rec.pushed) continue;
    const s = stateNow();
    rec.href = window.location.href;
    rec.idx = s?.idx;
    window.history.pushState({ ...(s ?? {}), [MARK]: rec.id }, '');
    rec.pushed = true;
  }
}

function onPop(e: PopStateEvent) {
  if (selfPops.length > 0) {
    const left = selfPops.shift();
    hide(e);
    if (left && markerOf(stateNow()) === left) {
      // 되돌리기 직전에 다른 화면이 쌓였다 → 제자리(그 화면)로 돌아간다. 남은 시트 항목은 나중에 건너뛴다
      hiddenPops += 1;
      window.history.forward();
      return;
    }
    if (collapse) {
      window.history.replaceState(collapse.state, '', collapse.url);
      collapse = null;
    }
    schedule();
    return;
  }
  if (hiddenPops > 0) {
    hiddenPops -= 1;
    hide(e);
    schedule();
    return;
  }
  const marker = markerOf(stateNow());
  const top = open[open.length - 1];
  if (top?.pushed && marker !== top.id) {
    // 뒤로가기로 시트 항목에서 벗어났다 → 시트만 닫는다
    open.pop();
    top.popped = true;
    if (window.location.href === top.href) hide(e);
    top.onClose();
    return;
  }
  if (marker && !open.some((r) => r.id === marker)) {
    // 주인이 없는 시트 항목(시트 안에서 다른 화면으로 떠났다가 돌아옴) → 한 칸 더 되돌린다
    hide(e);
    window.history.back();
  }
}

/** 첫 렌더 전(라우터가 popstate 를 듣기 전)에 한 번 부른다 */
export function installSheetHistory(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('popstate', onPop, true);
}

/** 시트가 열려 있는 동안 히스토리 한 칸과 묶는다 */
export function useSheetHistory(isOpen: boolean, onClose: () => void): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!isOpen || !installed) return;
    const rec: SheetRecord = { id: `s${++seq}`, onClose: () => latest.current(), pushed: false, href: '', idx: undefined, popped: false };
    open.push(rec);
    schedule();
    return () => {
      const i = open.indexOf(rec);
      if (i >= 0) open.splice(i, 1);
      if (rec.pushed && !rec.popped) closing.push(rec);
      schedule();
    };
  }, [isOpen]);
}

/** 테스트용 — 모듈 상태를 처음으로 돌린다 */
export function resetSheetHistoryForTest(): void {
  open.length = 0;
  closing.length = 0;
  selfPops.length = 0;
  hiddenPops = 0;
  collapse = null;
  scheduled = false;
  if (installed) window.removeEventListener('popstate', onPop, true);
  installed = false;
}
