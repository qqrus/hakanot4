import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1E293B", // Slate-800 for main text
        panel: "#FFFFFF", // Pure white for cards
        
        // Soft & Bright vibrant accents (Pastel-like)
        accent: "#38BDF8",      // Sky blue
        glow: "#38BDF840",      // Sky blue transparent
        primary: "#FB7185",     // Rose
        "primary-glow": "#FB718540",
        warning: "#FBBF24",     // Amber
        success: "#34D399",     // Emerald

        border: "#E2E8F0",      // Slate-200 for borders
        muted: "#94A3B8",       // Slate-400 for secondary text
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.4) 100%)',
      },
      boxShadow: {
        'panel': '0 10px 40px -10px rgba(0,0,0,0.08), 0px 4px 6px -4px rgba(0,0,0,0.04)',
        'neon': '12px 12px 24px #e6e9ef, -12px -12px 24px #ffffff', // Claymorphic base
        'neon-pink': '0 8px 30px -4px rgba(251, 113, 133, 0.4)',
      },
      animation: {
        'spin-slow': 'spin 12s linear infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'aurora': 'aurora 15s ease infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        aurora: {
          '0%': { transform: 'rotate(0deg) scale(1.2)' },
          '100%': { transform: 'rotate(45deg) scale(1.5)' },
        }
      }
    },
  },
  plugins: [],
};

export default config;
