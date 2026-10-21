import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_API_PROXY_TARGET || 'http://localhost:4000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin API calls in development: cookies and Server-Sent Events just work.
      proxy: { '/api': { target: api, changeOrigin: false } },
    },
    preview: { port: 5173 },
    build: { chunkSizeWarningLimit: 900 },
  };
});
