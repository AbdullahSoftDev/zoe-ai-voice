// vite.config.ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Add this to disable import protection for server files
  server: {
    hmr: {
      overlay: false, // Disable the overlay
    },
  },
  // Or use this to bypass the protection
  optimizeDeps: {
    exclude: ['@tanstack/react-start'],
  },
});