import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 打包成固定檔名的 graph.js 與 graph.css，放進 docs/relations/app/，由關係圖頁面載入
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '../docs/relations/app',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.jsx',
      formats: ['es'],
      fileName: () => 'graph.js',
      cssFileName: 'graph',
    },
  },
});
