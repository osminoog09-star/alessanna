/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#0f0f10", card: "#161618", border: "#2a2a2e" },
        accent: { DEFAULT: "#5b9cf8", muted: "rgba(91,156,248,0.15)" },
      },
    },
  },
  plugins: [],
};
