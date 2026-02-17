import { defineConfig } from 'vite';

export default defineConfig({
    root: '.',
    server: {
        port: 5173,
        host: '0.0.0.0',
        strictPort: false,
        open: false
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        minify: 'terser'
    }
});
