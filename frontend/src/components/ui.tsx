/** Basic building blocks (handoff §3): Button, StatusChip, StatTile, Callout, FilterTabs, FilterPills, tables and states. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { statusChip, type ChipTone, type StatusDomain } from '../lib/status';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------------------------ Button

type Variant = 'primary' | 'accent' | 'secondary' | 'danger';
const VARIANT: Record<Variant, string> = { primary: '', accent: 'btn-accent', secondary: 'btn-secondary', danger: 'btn-danger' };

/** Disabled buttons need a reason: it becomes the title tooltip (handoff §3). */
export function Button({
  variant = 'primary',
  disabledReason,
  className,
  size,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; disabledReason?: string | false; size?: 'sm' | 'form' }) {
  const disabled = rest.disabled || !!disabledReason;
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      title={disabledReason || rest.title}
      className={cx('btn', VARIANT[variant], size === 'sm' && 'btn-sm', size === 'form' && 'btn-form', className)}
    />
  );
}

export function LinkButton({ to, variant = 'primary', children, size }: { to: string; variant?: Variant; children: ReactNode; size?: 'sm' }) {
  return (
    <Link to={to} className={cx('btn', VARIANT[variant], size === 'sm' && 'btn-sm')}>
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------ Chips

const TONE: Record<ChipTone, string> = { cyan: 'chip-cyan', steel: 'chip-steel', yellow: 'chip-yellow', red: 'chip-red', green: 'chip-green', neutral: '' };

export function Chip({ tone = 'neutral', children, dot = true, mono }: { tone?: ChipTone; children: ReactNode; dot?: boolean; mono?: boolean }) {
  return (
    <span className={cx('chip', TONE[tone], mono && 'font-mono')}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Status chip: always text + colour, never colour alone. */
export function StatusChip({ domain, status, label }: { domain: StatusDomain; status: string; label?: string }) {
  const [tone, text] = statusChip(domain, status);
  return <Chip tone={tone}>{label ?? text}</Chip>;
}

export function TagChip({ children }: { children: ReactNode }) {
  return (
    <Chip dot={false} mono>
      {children}
    </Chip>
  );
}

// ------------------------------------------------------------------ Page structure

export function PageHeader({ eyebrow, title, mono, sub, actions, chips }: { eyebrow?: ReactNode; title: ReactNode; mono?: boolean; sub?: ReactNode; actions?: ReactNode; chips?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className={mono ? 'id-title break-all' : 'page-title'}>{title}</h1>
        {sub && <div className="max-w-[760px] text-[14px] leading-relaxed text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, aside, children, className, pad = true }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('card', className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="section-title">{title}</h2>}
          {aside && <div className="text-[12px] text-muted">{aside}</div>}
        </div>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="font-mono text-[12px] text-muted">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && ' / '}
          {it.to ? <Link to={it.to}>{it.label}</Link> : it.label}
        </span>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------------ StatTile

export function StatTile({ label, value, sub, to, variant }: { label: string; value: ReactNode; sub?: ReactNode; to?: string; variant?: 'inverse' | 'attention' }) {
  const body = (
    <>
      <span className={cx('eyebrow', variant === 'inverse' && 'text-muted-dark')}>{label}</span>
      <span className="font-mono text-[26px] font-semibold leading-tight">{value}</span>
      {sub && <span className={cx('text-[12px]', variant === 'inverse' ? 'text-muted-dark-2' : 'text-muted')}>{sub}</span>}
    </>
  );
  const cls = cx(
    'flex flex-col gap-1.5 rounded-card border p-4 no-underline',
    variant === 'inverse' ? 'border-ink bg-ink text-white' : variant === 'attention' ? 'border-yellow bg-yellow text-ink' : 'border-line bg-surface text-ink',
    to && 'hover:border-ink',
  );
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>{children}</div>;
}

// ------------------------------------------------------------------ Callout

export function Callout({ tone = 'info', title, children, tag }: { tone?: 'info' | 'warning' | 'error' | 'ink'; title?: ReactNode; children?: ReactNode; tag?: string }) {
  const cls = {
    info: 'border-tint-steel bg-tint-steel text-ink',
    warning: 'border-tint-yellow-line bg-tint-yellow text-ink',
    error: 'border-tint-red-line bg-tint-red text-ink',
    ink: 'border-ink bg-ink text-white',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cx('flex items-start gap-3 rounded-card border px-4 py-3 text-[13px] leading-relaxed', cls)}>
      {tag && <span className="flex-none rounded-chip bg-yellow px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink">{tag}</span>}
      <div className="min-w-0">
        {title && <b>{title} </b>}
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Tabs and pills

export function FilterTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className="tab" onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function FilterPills<T extends string>({ pills, value, onChange, label }: { pills: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {pills.map((p) => (
        <button key={p.id} type="button" className="pill" aria-pressed={p.id === value} onClick={() => onChange(p.id)}>
          {p.label}
          {p.count !== undefined && <span className="count">{p.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Tables

/** DataTable container: scrolls horizontally inside its card on narrow screens. */
export function TableCard({ children, footer, title, aside }: { children: ReactNode; footer?: ReactNode; title?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      {(title || aside) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="section-title">{title}</h2>}
          {aside && <div className="text-[12px] text-muted">{aside}</div>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="tbl">{children}</table>
      </div>
      {footer && <div className="flex justify-between border-t border-line bg-surface-2 px-4 py-2.5 text-[12px] text-muted">{footer}</div>}
    </section>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="py-8 text-center text-muted">
        {children}
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------ States (handoff screen 05)

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="card flex flex-col items-start gap-3 p-6">
      <span className="eyebrow">Empty</span>
      <h2 className="text-[18px] font-bold">{title}</h2>
      {children && <p className="m-0 max-w-[560px] text-[14px] leading-relaxed text-muted">{children}</p>}
      {action}
    </section>
  );
}

export function ErrorState({ error, action }: { error: unknown; action?: ReactNode }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 404) {
    return (
      <section className="card flex flex-col items-start gap-3 p-6">
        <span className="font-mono text-[40px] font-semibold text-muted">404</span>
        <h2 className="text-[18px] font-bold">No asset with that key</h2>
        <p className="m-0 max-w-[560px] text-muted">{e.message}</p>
        <div className="flex gap-2">
          <LinkButton to="/regulator/explorer">Search the ledger</LinkButton>
          <LinkButton to="/" variant="secondary">
            Home
          </LinkButton>
        </div>
      </section>
    );
  }
  return (
    <section className="card flex flex-col items-start gap-3 border-tint-red-line p-6">
      <span className="eyebrow">Request failed</span>
      <pre className="m-0 whitespace-pre-wrap break-words rounded-card bg-tint-red p-3 font-mono text-[13px]">{e ? e.message : String((error as Error)?.message ?? error)}</pre>
      {action}
    </section>
  );
}

export function Loading({ what = 'querying the ledger' }: { what?: string }) {
  return (
    <div className="card flex flex-col gap-3 p-4" aria-label="Loading" aria-busy="true">
      <div className="skeleton h-4 w-2/5" />
      <div className="skeleton h-4 w-4/5" />
      <div className="skeleton h-4 w-3/5" />
      <span className="font-mono text-[12px] text-muted">{what}…</span>
    </div>
  );
}

/** Wraps a query: loading skeleton, error card, or children with data. */
export function Async<T>({ q, children, what }: { q: { data: T | undefined; error: unknown; isLoading: boolean }; children: (data: T) => ReactNode; what?: string }) {
  if (q.isLoading) return <Loading {...(what ? { what } : {})} />;
  if (q.error) return <ErrorState error={q.error} />;
  if (q.data === undefined) return null;
  return <>{children(q.data)}</>;
}

// ------------------------------------------------------------------ Misc

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono', className)}>{children}</span>;
}

export function Signs({ fn, as }: { fn: string; as?: string | null }) {
  return (
    <span className="hint">
      Signs <Mono>{fn}</Mono>
      {as ? ` as ${as}` : ''}
    </span>
  );
}

export { cx };
