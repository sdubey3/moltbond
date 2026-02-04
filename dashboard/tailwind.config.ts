import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}","./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bond: { bg: "#0a0a0f", card: "#12121a", border: "#1e1e2e", accent: "#6366f1", green: "#22c55e", red: "#ef4444", yellow: "#eab308", muted: "#64748b" }
      }
    }
  },
  plugins: [],
};
export default config;
