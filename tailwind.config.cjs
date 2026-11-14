/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/pages/**/*.{ts,tsx}",
    "./src/views/**/*.{ts,tsx}",
    "./src/widgets/**/*.{ts,tsx}",
    "./src/features/**/*.{ts,tsx}",
    "./src/entities/**/*.{ts,tsx}",
    "./src/shared/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Палитра: серый, синий, белый. Три цвета, больше не нужно.
         *
         * slate — холодный серый, а не тёплый neutral: рядом с синим
         * тёплый серый выглядит грязно. Холодный серый даёт «инженерный»
         * вид, который уместен для оборудования.
         */
        slate: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#070d19",
        },
        /**
         * accent — единственный синий. Линейка подобрана так, чтобы
         * 600 проходил по контрасту WCAG AA на белом (4.5:1) и годился
         * для текста, а 500 — для крупных элементов.
         */
        accent: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        // Статусы: сознательно приглушённые, чтобы не спорить с синим.
        // Насыщенные светофорные цвета превратили бы серьёзный интерфейс
        // в панель приборов.
        ok: "#059669",
        warn: "#b45309",
        bad: "#b91c1c",
        info: "#2563eb",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      /**
       * Сетка кеглей с крупным шагом.
       *
       * Заголовки намеренно большие: 60px на главной — это то, что
       * отличает витрину от админки. В рабочем экране используем
       * нижние ступени.
       */
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        display: ["4rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "6xl": ["3.75rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "5xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        "4xl": ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "3xl": ["1.875rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        /**
         * Тени мягкие и многослойные. Одна большая тень выглядит дёшево:
         * настоящий свет рассеивается, поэтому слоёв три — тонкий контур,
         * ближняя тень, дальняя.
         */
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.05), 0 16px 32px -12px rgba(15,23,42,0.08)",
        lift: "0 2px 4px rgba(15,23,42,0.05), 0 12px 24px -8px rgba(15,23,42,0.10), 0 32px 64px -24px rgba(15,23,42,0.14)",
        glow: "0 0 0 1px rgba(37,99,235,0.10), 0 8px 24px -8px rgba(37,99,235,0.28)",
      },
      /**
       * Анимации. Только те, что реально применяются: получить эффект,
       * который нигде не виден, легко, а заметить его случайное влияние
       * на другие элементы — нет.
       */
      animation: {
        "slide-up": "slide-up 0.45s cubic-bezier(0.22,1,0.36,1)",
        "slide-up-slow": "slide-up 0.7s cubic-bezier(0.22,1,0.36,1)",
      },
      keyframes: {
        "slide-up": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      /**
       * Уважаем системную настройку «меньше движения».
       * Не украшение: у части людей анимация вызывает тошноту.
       */
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
