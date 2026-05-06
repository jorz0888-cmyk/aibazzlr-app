import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0d0d14",
          surface: "#14141f",
          elevated: "#1a1a28",
        },
        cyan: {
          DEFAULT: "#00d9ff",
          dim: "rgba(0,217,255,0.12)",
          glow: "rgba(0,217,255,0.35)",
        },
        accent: {
          DEFAULT: "#7F77DD",
          dim: "rgba(127,119,221,0.12)",
        },
        ink: {
          DEFAULT: "#f0eeff",
          muted: "#8884aa",
          subtle: "#5a5775",
        },
        line: {
          DEFAULT: "rgba(255,255,255,0.08)",
          strong: "rgba(255,255,255,0.14)",
        },
        danger: "#ff5d6c",
        success: "#4ade80",
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px",
      },
      boxShadow: {
        cyan: "0 10px 40px -10px rgba(0,217,255,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
