import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Privy + its transitive deps (React, wallet libs, polyfills) — lazy-loaded chunk
const PRIVY_PACKAGES = [
  '@privy-io', 'viem', '@walletconnect', 'wagmi', '@base-org/account',
  '/ox/', '/react/', '/react-dom/', '/scheduler/', '/buffer/',
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('three')) return 'vendor-three';
          if (PRIVY_PACKAGES.some(pkg => id.includes(pkg))) return 'vendor-privy';
          return 'vendor';
        },
      },
    },
  },
});
