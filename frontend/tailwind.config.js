/** @type {import('tailwindcss').Config} */

/* Semantic colours only — every value resolves to a CSS variable declared in
   src/index.css, so both themes work without duplicating class names.
   `<alpha-value>` keeps opacity modifiers (bg-accent/12) working. */
const channel = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: channel('--c-bg'),
        surface: channel('--c-surface'),
        'surface-2': channel('--c-surface-2'),
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: channel('--c-text'),
        dim: channel('--c-text-dim'),
        muted: channel('--c-text-muted'),
        accent: {
          DEFAULT: channel('--c-accent'),
          hover: channel('--c-accent-hover'),
          soft: 'var(--accent-soft)',
        },
        success: channel('--c-success'),
        warning: channel('--c-warning'),
        danger: channel('--c-danger'),
        veil: 'var(--hover-veil)',
        scrim: 'var(--scrim)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
      fontFamily: {
        sans: ['ui-sans-serif', '-apple-system', 'Segoe UI', 'Roboto', 'Inter', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        control: '10px',
        card: '14px',
        pill: '999px',
      },
      spacing: {
        sidebar: '240px',
        rail: '60px',
        topbar: '56px',
      },
      maxWidth: {
        content: '1280px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'row-in': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out both',
        'scale-in': 'scale-in 150ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-right': 'slide-in-right 180ms cubic-bezier(0.16,1,0.3,1) both',
        'row-in': 'row-in 180ms ease-out both',
        'soft-pulse': 'soft-pulse 1.8s ease-in-out infinite',
      },
      transitionDuration: {
        120: '120ms',
      },
    },
  },
  plugins: [],
};
