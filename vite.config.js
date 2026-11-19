import { defineConfig } from 'vite';

// La versión la calcula el workflow desde los tags (vX.Y.Z) y la pasa como VITE_APP_VERSION.
const version = process.env.VITE_APP_VERSION || '0.0.0-dev';

export default defineConfig({
  base: './', // rutas relativas: sirve igual en GitHub Pages (/notas/) y dentro del APK
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      name: 'app-version',
      transformIndexHtml: (html) => html.replaceAll('__APP_VERSION__', version),
    },
  ],
  build: { outDir: 'dist', target: 'es2020' },
});
