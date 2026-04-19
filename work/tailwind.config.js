/** @type {import('tailwindcss').Config} */

/* Брендовые токены через CSS-переменные.
 * Реальные значения по темам (onyx/champagne/stone) живут в src/index.css.
 * Tailwind-классы вида `bg-canvas` / `text-fg` / `border-line` тогда сразу
 * подхватывают активную тему через data-theme на <html>. */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--c-canvas) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--c-surface) / <alpha-value>)",
          card: "rgb(var(--c-panel) / <alpha-value>)",
          border: "rgb(var(--c-line) / <alpha-value>)",
        },
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        gold: {
          DEFAULT: "rgb(var(--c-gold) / <alpha-value>)",
          soft: "rgb(var(--c-gold-soft) / <alpha-value>)",
          deep: "rgb(var(--c-gold-deep) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-gold) / <alpha-value>)",
          muted: "rgb(var(--c-gold-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', '"Playfair Display"', "Georgia", "serif"],
      },
      boxShadow: {
        gold: "0 0 32px rgba(196, 165, 116, 0.18)",
      },
    },
  },
  plugins: [],
};
