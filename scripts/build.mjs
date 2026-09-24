import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await mkdir('dist/vendor', { recursive: true });

await Promise.all([
  cp('assets', 'dist/assets', { recursive: true }),
  cp('vendor', 'dist/vendor', { recursive: true }),
]);

const sourceHtml = await readFile('index.html', 'utf8');
await writeFile('dist/index.html', sourceHtml);

console.log('Built dist/ using the native MakLom interface.');
