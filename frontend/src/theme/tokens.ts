/** Design tokens from wrt-design/DESIGN_HANDOFF.md §2. Mirrored in tailwind.config.ts. */
export const colors = {
  ink: '#0B1726',
  'ink-2': '#13253A',
  'ink-2-active': '#16304A',
  'ink-line': '#1E3349',
  'ink-line-2': '#23394F',
  'ink-chip-line': '#2A4058',
  canvas: '#F2F6FA',
  surface: '#FFFFFF',
  'surface-2': '#F7FAFC',
  line: '#D9E3EC',
  'line-soft': '#EAF0F5',
  'input-line': '#C9D6E2',
  muted: '#4E6275',
  'muted-dark': '#8FA6BC',
  'muted-dark-2': '#B8C7D6',
  'muted-dark-3': '#7F96AC',
  cyan: '#00BDFF',
  yellow: '#FBD116',
  steel: '#56A7D2',
  link: '#00739F',
  success: '#12A150',
  danger: '#E5484D',
  'danger-strong': '#C8282E',
  'tint-cyan': '#E0F6FF',
  'tint-steel': '#E3F0F8',
  'tint-yellow': '#FEF6CC',
  'tint-yellow-line': '#F3DD6B',
  'tint-red': '#FDE7E8',
  'tint-red-line': '#F4B4B6',
  'tint-green': '#E2F5EA',
  'tint-neutral': '#EEF3F8',
  'neutral-dot': '#8A9BAD',
} as const;

export const fonts = {
  sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
  mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
};

export const shadow = { dialog: '0 1px 2px rgba(11,23,38,.08), 0 12px 32px rgba(11,23,38,.18)' };
