import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await mkdir('dist/vendor', { recursive: true });

await Promise.all([
  cp('assets', 'dist/assets', { recursive: true }),
  cp('vendor', 'dist/vendor', { recursive: true }),
]);
await cp('node_modules/@awesome.me/webawesome/dist-cdn', 'dist/vendor/webawesome', { recursive: true });

const sourceHtml = await readFile('index.html', 'utf8');
const webAwesomeHead = [
  '<link rel="stylesheet" href="vendor/webawesome/styles/webawesome.css">',
  '<link rel="stylesheet" href="assets/webawesome-ui.css?v=20260921-1">',
  '<link rel="stylesheet" href="assets/webawesome-controls.css?v=20260917-2">',
  '<link rel="stylesheet" href="assets/webawesome-overlays.css?v=20260917-2">',
  '<script type="module" src="vendor/webawesome/webawesome.loader.js"></script>',
].join('\n');
const webAwesomeScripts = [
  '<script src="assets/webawesome-ui.js?v=20260921-1"></script>',
  '<script src="assets/webawesome-controls.js?v=20260917-2"></script>',
  '<script src="assets/webawesome-overlays.js?v=20260917-2"></script>',
  '<script src="assets/webawesome-dialogs.js?v=20260917-2"></script>',
].join('\n');

let outputHtml = sourceHtml.replace('</head>', webAwesomeHead + '\n</head>');
outputHtml = outputHtml.replace('</body>', webAwesomeScripts + '\n</body>');
await writeFile('dist/index.html', outputHtml);

console.log('Built dist/ with self-hosted Web Awesome 3.12.0');
