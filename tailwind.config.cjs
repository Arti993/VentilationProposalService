/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/pages/**/*.{ts,tsx}",
    "./src/widgets/**/*.{ts,tsx}",
    "./src/features/**/*.{ts,tsx}",
    "./src/entities/**/*.{ts,tsx}",
    "./src/shared/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Палитра: сдержанная «инженерная» — тёмный графит + акцент меди.
        // Медь ассоциируется с воздуховодами и хорошо читается на светлом.
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d5dae3",
          300: "#b0bacb",
          400: "#8494ad",
          500: "#657692",
          600: "#505e78",
          700: "#424d62",
          800: "#3a4253",
          900: "#1c2028",
          950: "#12151a",
        },
        copper: {
          50: "#fdf6f1",
          100: "#f9e9dc",
          200: "#f2d0b6",
          300: "#e8ae86",
          400: "#dd8554",
          500: "#d46a35",
          600: "#c4532a",
          700: "#a33e25",
          800: "#833425",
          900: "#6b2e22",
        },
        // Статусы
        ok: "#16a34a",
        warn: "#d97706",
        bad: "#dc2626",
        info: "#2563eb",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "0.625rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [],
};
