import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works at https://<user>.github.io/<repo>/ without config.
export default defineConfig({
  plugins: [react()],
  base: "./",
  test: { include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
} as any);
