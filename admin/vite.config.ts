import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { copyFile } from 'node:fs/promises';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-version-metadata',
      closeBundle: () => copyFile(
        path.resolve(__dirname, '../version.json'),
        path.resolve(__dirname, 'dist/version.json'),
      ),
    },
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    host: true,
  },
});
