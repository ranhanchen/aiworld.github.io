/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        mobile: { max: '767px' },
        tablet: '768px',
        desktop: '1024px',
      },
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          dark: '#1a1a2e',
        },
        panel: {
          DEFAULT: '#f8f9fa',
          dark: '#16213e',
        },
        accent: {
          DEFAULT: '#6366f1',
          dark: '#818cf8',
        },
        'text-primary': {
          DEFAULT: '#1f2937',
          dark: '#e5e7eb',
        },
        'text-secondary': {
          DEFAULT: '#6b7280',
          dark: '#9ca3af',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
        sans: ['"Inter"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-highlight': 'pulseHighlight 2s ease-in-out 3',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        pulseHighlight: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(99, 102, 241, 0.4)' },
          '50%': { boxShadow: '0 0 0 8px rgba(99, 102, 241, 0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
