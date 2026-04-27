import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ['react', 'react-dom', 'react-dom/client', '@testing-library/react'],
        },
      },
    },
  },
});
