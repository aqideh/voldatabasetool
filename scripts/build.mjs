import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });

await Promise.all([
  cp('index.html', 'dist/index.html'),
  cp('assets', 'dist/assets', { recursive: true }),
  cp('vendor', 'dist/vendor', { recursive: true }),
]);

await build({
  entryPoints: ['src/mantine-shell.jsx'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/assets/mantine-shell.js',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
});

await cp('node_modules/@mantine/core/styles.css', 'dist/assets/mantine.css');
console.log('Built dist/ with Mantine shell');
