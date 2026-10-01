/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0f0f1a',
        surface: '#1a1a2e',
        surfaceLight: '#252542',
        border: '#2d2d4a',
        accent: '#6366f1',
        accentHover: '#818cf8',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        textPrimary: '#e2e8f0',
        textSecondary: '#94a3b8',
        textMuted: '#64748b',
        nodeMatch: '#6366f1',
        nodeOther: '#64748b',
        edgeConfirmed: '#10b981',
        edgeSuspected: '#f59e0b',
      },
    },
  },
  plugins: [],
};
