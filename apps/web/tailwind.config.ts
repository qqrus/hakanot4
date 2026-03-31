import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#07111f",
        panel: "#0f1c2c",
        accent: "#39d0a0",
        glow: "#7ef0c6",
        border: "#203246",
        muted: "#91a4bb",
      },
      boxShadow: {
        panel: "0 24px 60px rgba(5, 10, 16, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
