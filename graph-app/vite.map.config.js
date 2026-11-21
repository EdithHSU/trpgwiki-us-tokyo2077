import { defineConfig } from 'vite';

// 互動地圖（three.js）打包成固定檔名的 map.js 與 map.css，放進 docs/map/app/，由地圖頁面載入
export default defineConfig({
  build: {
    outDir: '../docs/map/app',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/map/main.js',
      formats: ['es'],
      fileName: () => 'map.js',
      cssFileName: 'map',
    },
  },
});
