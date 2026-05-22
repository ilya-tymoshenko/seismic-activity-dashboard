/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        panel: "#ffffff",
        canvas: "#f3f6fb",
        coral: "#e15b42",
        amber: "#f3a712",
        ocean: "#1976a2",
        mint: "#2ca58d"
      },
      boxShadow: {
        panel: "0 14px 35px rgba(23, 32, 42, 0.08)"
      }
    }
  },
  plugins: []
};
