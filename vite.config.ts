import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 클래식 워커: 배포용 HTML(file://)에서는 blob 모듈 워커가 막혀 iife로 묶는다
  worker: { format: 'iife' },
});
