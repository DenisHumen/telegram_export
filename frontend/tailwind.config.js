/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0B0F14',
        surface: '#111823',
        surface2: '#151E2B',
        surface3: '#1B2634',
        line: 'rgba(255,255,255,0.06)',
        line2: 'rgba(255,255,255,0.12)',
        accent: {
          DEFAULT: '#3390EC',
          soft: '#5CC8FF',
          deep: '#1F6FBF',
        },
        success: '#3DD68C',
        warning: '#F5A524',
        danger: '#F2555A',
        ink: {
          DEFAULT: '#E8EEF6',
          muted: '#8FA0B5',
          faint: '#5E6E82',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'JetBrains Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.8)',
        lift: '0 18px 40px -18px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)',
        glow: '0 0 0 1px rgba(51,144,236,0.4), 0 8px 30px -10px rgba(51,144,236,0.55)',
      },
      backgroundImage: {
        'accent-grad': 'linear-gradient(100deg, #3390EC 0%, #5CC8FF 100%)',
        'panel-grad': 'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0) 100%)',
      },
      keyframes: {
        sheen: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        sheen: 'sheen 1.8s ease-in-out infinite',
        shimmer: 'shimmer 1.4s linear infinite',
        'fade-in': 'fade-in 180ms ease-out both',
        'scale-in': 'scale-in 160ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.16,1,0.3,1) both',
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
      },
      transitionDuration: {
        150: '150ms',
      },
      maxWidth: {
        content: '1400px',
      },
    },
  },
  plugins: [],
};
