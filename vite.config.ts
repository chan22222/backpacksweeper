import { defineConfig } from 'vitest/config';

// Vite + Vitest 통합 설정.
// 게임 빌드와 순수 코어 단위 테스트(안전망 ①②)를 한 설정으로 관리한다.
export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
