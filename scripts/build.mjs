import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await mkdir('dist/vendor', { recursive: true });

await Promise.all([
  cp('assets', 'dist/assets', { recursive: true }),
  cp('vendor', 'dist/vendor', { recursive: true }),
]);
await cp('node_modules/@awesome.me/webawesome/dist-cdn', 'dist/vendor/webawesome', { recursive: true });

let sourceHtml = await readFile('index.html', 'utf8');
sourceHtml = sourceHtml
  .replace('<link rel="stylesheet" href="assets/mantine.css">\n', '')
  .replace('<link rel="stylesheet" href="assets/mantine-bridge.css?v=20260916-1">\n', '')
  .replace('<div id="mantineShell"></div>\n', '')
  .replace('<script src="assets/mantine-shell.js?v=20260916-1"></script>\n', '');

const webAwesomeHead = [
  '<link rel="stylesheet" href="vendor/webawesome/styles/webawesome.css">',
  '<link rel="stylesheet" href="assets/webawesome-events.css?v=20260916-1">',
  '<link rel="stylesheet" href="assets/webawesome-ui.css?v=20260916-1">',
  '<script type="module" src="vendor/webawesome/webawesome.loader.js"></script>',
].join('\n');
const webAwesomeScripts = [
  '<script src="assets/webawesome-events.js?v=20260916-1"></script>',
  '<script src="assets/webawesome-ui.js?v=20260916-1"></script>',
].join('\n');

let outputHtml = sourceHtml.replace('</head>', webAwesomeHead + '\n</head>');
outputHtml = outputHtml.replace('</body>', webAwesomeScripts + '\n</body>');
await writeFile('dist/index.html', outputHtml);

console.log('Built dist/ with self-hosted Web Awesome 3.12.0');
