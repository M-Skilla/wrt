/**
 * Display formatting (handoff §7). Values are integers end to end: TZS, kg, bp.
 * Parsing user input turns "13.4" into 1340 bp with string arithmetic, never floats.
 */

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 4540000 -> "4,540,000" */
export function tzs(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : grouped.format(n);
}

/** Signed escrow amount: "+1,000,000" / "−6,000,000" */
export function signedTzs(n: number, outflow: boolean): string {
  return `${outflow ? '−' : '+'}${grouped.format(n)}`;
}

/** 10540000 -> "10.54M" (stat tiles) */
export function tzsShort(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${trimZeros((n / 1_000_000).toFixed(2))}M`;
  if (n >= 10_000) return `${trimZeros((n / 1_000).toFixed(1))}k`;
  return grouped.format(n);
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, '');
}

export function kg(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${grouped.format(n)} kg`;
}

/** Basis points as a percentage string: bpPct(1340) = "13.4%", bpPct(4307, 1) = "43.1%". */
export function bpPct(bp: number | null | undefined, decimals = 1, suffix = '%'): string {
  if (bp === null || bp === undefined) return '—';
  const sign = bp < 0 ? '−' : '';
  const abs = Math.abs(bp);
  const scaled = Math.round(abs / 10 ** (2 - decimals));
  const whole = Math.floor(scaled / 10 ** decimals);
  const frac = decimals > 0 ? `.${String(scaled % 10 ** decimals).padStart(decimals, '0')}` : '';
  return `${sign}${whole}${frac}${suffix}`;
}

/** Signed gap in bp: "+0.20%" / "−8.00%" */
export function signedBp(bp: number, decimals = 2, suffix = '%'): string {
  return `${bp > 0 ? '+' : bp < 0 ? '' : '±'}${bpPct(bp, decimals, suffix)}`;
}

/** "4,050" or "4050" -> 4050; returns null if not a whole number. */
export function parseWhole(input: string): number | null {
  const clean = input.replace(/[,\s_]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) ? n : null;
}

/** "13.4" (percent) -> 1340 bp; up to 2 decimals; null if invalid. */
export function parsePercentToBp(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(input);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** Percent string from bp for an input box: 1340 -> "13.4", 850 -> "8.5" */
export function bpToInput(bp: number): string {
  return bpPct(bp, 2, '').replace(/\.?0+$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "11 Oct 2026" */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "11 Oct 2026 09:41" */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${date(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Feed style: "09:41" today, "11 Oct 09:41" this year, else "11 Oct 2026". */
export function feedTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return date(iso);
}

/** "26 Feb 27" (compact table date) */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/** Human duration from seconds: 604800 -> "7 d", 180 -> "3 min" */
export function duration(secs: number): string {
  const s = Math.abs(secs);
  if (s >= 86_400) return `${Math.round(s / 86_400)} d`;
  if (s >= 3_600) return `${Math.round(s / 3_600)} h`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s)} s`;
}

export function secondsUntil(iso: string | null | undefined): number | null {
  return iso ? Math.round((new Date(iso).getTime() - Date.now()) / 1000) : null;
}

export function ago(iso: string | null | undefined): string {
  const s = secondsUntil(iso);
  return s === null ? '—' : `${duration(-s)} ago`;
}

/** Tx hashes shortened as 7f3a9c…e21b */
export function shortHash(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return '—';
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** MAIZE -> Maize */
export const commodity = (c: string) => titleCase(c);

/** "WRT-WH001-000123" -> "WH001-000123" (table shorthand used in the mockups) */
export function shortReceipt(id: string): string {
  return id.replace(/^WRT-/, '');
}

export const orgShort: Record<string, string> = { WarehouseMSP: 'WH', LenderMSP: 'LN', InspectorMSP: 'IN', RegulatorMSP: 'RG' };
