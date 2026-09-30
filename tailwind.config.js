/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        // Circle brand magenta (#E40071)
        brand: {
          50: '#fdf0f7', 100: '#fbdcec', 200: '#f8b8d9', 300: '#f288bf', 400: '#ea4d9c',
          500: '#e40071', 600: '#c90064', 700: '#a80053', 800: '#870043', 900: '#6b0036',
        },
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' },
    },
  },
  plugins: [],
};
