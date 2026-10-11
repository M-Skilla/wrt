import type { Config } from 'tailwindcss';
import { colors, fonts, shadow } from './src/theme/tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      fontFamily: { sans: fonts.sans, mono: fonts.mono },
      boxShadow: shadow,
      borderRadius: { chip: '4px', card: '6px', dialog: '8px' },
    },
  },
  plugins: [],
} satisfies Config;
