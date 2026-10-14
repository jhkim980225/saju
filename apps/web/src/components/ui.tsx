import { AlertCircle, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** 본문 폭 — 모바일은 모두 max-w-xl, 데스크톱(lg↑)에서만 넓어진다 */
export type PageWidth = 'narrow' | 'medium' | 'wide';
export const PAGE_WIDTH: Record<PageWidth, string> = {
  narrow: 'max-w-xl',
  medium: 'max-w-xl lg:max-w-3xl lg:px-8',
  wide: 'max-w-xl lg:max-w-6xl lg:px-8',
};

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; loading?: boolean; size?: 'md' | 'lg' | 'sm' }>(
  function Button({ variant = 'primary', block, loading, size = 'md', className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[opacity,transform] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
          size === 'lg' && 'h-14 px-6 text-[17px]',
          size === 'md' && 'h-12 px-5 text-base',
          size === 'sm' && 'h-10 px-4 text-sm',
          variant === 'primary' && 'bg-action text-on-action',
          variant === 'secondary' && 'bg-action-2 text-ink',
          variant === 'ghost' && 'bg-transparent text-ink-2 underline-offset-4 hover:underline',
          variant === 'gold' && 'border border-gold bg-surface text-gold',
          block && 'w-full',
          className,
        )}
        {...rest}
      >
        {loading && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export function Card({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' }) {
  return <As className={cx('rounded-2xl border border-line bg-surface p-5', className)}>{children}</As>;
}

export function Segmented<T extends string>({ value, onChange, options, name }: { value: T | ''; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-1 rounded-xl bg-subtle p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-11 rounded-lg text-[15px] font-medium transition-colors', value === o.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-3')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, required, helper, error, children, htmlFor }: { label: string; required?: boolean; helper?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-[15px] font-semibold text-ink">
        {label}
        {required && <span className="text-ink-3" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : helper ? (
        <p className="text-sm text-ink-3">{helper}</p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function TextInput({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        'h-13 w-full rounded-xl border bg-surface px-4 text-base text-ink outline-none placeholder:text-ink-3 focus:border-ink',
        invalid ? 'border-danger' : 'border-line-strong',
        className,
      )}
      {...rest}
    />
  );
});

export function Chip({ active, onClick, children, className }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors',
        active ? 'border-ink bg-action text-on-action' : 'border-line-strong bg-surface text-ink-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cx('relative h-7 w-12 rounded-full transition-colors', checked ? 'bg-action' : 'bg-line-strong')}>
      <span className={cx('absolute left-0 top-0.5 size-6 rounded-full bg-surface shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Spinner({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-ink-3">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="font-serif text-4xl text-line-strong" aria-hidden>
        空
      </div>
      <p className="text-lg font-semibold text-ink">{title}</p>
      {body && <p className="text-[15px] leading-relaxed text-ink-2">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <AlertCircle className="size-8 text-danger" aria-hidden />
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="text-[15px] text-ink-2">{body}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'gold' | 'success' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
        tone === 'default' && 'bg-subtle text-ink-2',
        tone === 'gold' && 'border border-gold/40 text-gold',
        tone === 'success' && 'bg-subtle text-success',
      )}
    >
      {children}
    </span>
  );
}

export function ScoreBar({ score, label }: { score: number; label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-label={label ? `${label} ${score}점` : `${score}점`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
        <div className="h-full rounded-full bg-action transition-[width] duration-500" style={{ width: `${score}%` }} />
      </div>
      <span className="tabular w-8 text-right text-sm font-semibold text-ink-2">{score}</span>
    </div>
  );
}

/** 모바일: 상단 고정 앱바(가운데 제목) / 데스크톱: 상단 내비 아래의 왼쪽 정렬 페이지 제목 */
export function PageHeader({ title, left, right, width = 'narrow' }: { title?: ReactNode; left?: ReactNode; right?: ReactNode; width?: PageWidth }) {
  return (
    <header className="safe-top sticky top-0 z-30 bg-canvas/95 backdrop-blur lg:static lg:bg-transparent lg:backdrop-blur-none print:hidden">
      <div className={cx('mx-auto flex h-14 items-center gap-2 px-4 lg:h-auto lg:pb-2 lg:pt-10', PAGE_WIDTH[width])}>
        <div className={cx('flex min-w-10 items-center lg:min-w-0', !left && 'lg:hidden')}>{left}</div>
        <h1 className="flex-1 truncate text-center text-[17px] font-semibold lg:text-left lg:text-2xl">{title}</h1>
        <div className="flex min-w-10 items-center justify-end gap-1">{right}</div>
      </div>
    </header>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="grid size-11 place-items-center rounded-full text-ink hover:bg-subtle">
      {children}
    </button>
  );
}
