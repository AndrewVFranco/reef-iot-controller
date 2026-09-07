/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Base surface colors — dark blue-grey palette
        surface: {
          900: "#0a0e1a",   // page background
          800: "#111827",   // card background
          700: "#1a2235",   // elevated card / input background
          600: "#232d42",   // borders, dividers
          500: "#2e3a52",   // hover states
        },
        // Accent — cyan/teal for a reef/ocean feel
        accent: {
          DEFAULT: "#06b6d4",  // cyan-500
          light:   "#22d3ee",  // cyan-400
          dark:    "#0891b2",  // cyan-600
          muted:   "#164e63",  // cyan-950 — subtle highlight bg
        },
        // Status colors
        status: {
          ok:      "#10b981",  // emerald-500
          warning: "#f59e0b",  // amber-500
          fault:   "#ef4444",  // red-500
          offline: "#6b7280",  // gray-500
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl:  "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card:  "0 4px 24px 0 rgba(0,0,0,0.4)",
        glow:  "0 0 20px 0 rgba(6,182,212,0.15)",
        fault: "0 0 20px 0 rgba(239,68,68,0.15)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "fade-in":    "fadeIn 0.2s ease-out",
        "slide-up":   "slideUp 0.25s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
}
