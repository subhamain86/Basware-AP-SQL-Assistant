/**
 * Build script — esbuild bundles src/main.ts into a single PLAIN
 * (non-module, IIFE) script, embedded directly into index.html together
 * with the stylesheet, producing one self-contained file. This makes the
 * app work identically whether opened by double-click (file://) or served
 * over http/https — ES module <script> tags are blocked by browsers on
 * file://.
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const result = await build({
    entryPoints: [path.join(root, 'src', 'main.ts')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    write: false,
    minify: false,
    logLevel: 'silent',
  });
  const jsBundle = result.outputFiles[0].text;

  const css = await readFile(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
  const favicon = await readFile(path.join(root, 'public', 'favicon.svg'), 'utf8');
  const faviconDataUri = 'data:image/svg+xml;base64,' + Buffer.from(favicon).toString('base64');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="${faviconDataUri}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AP-SQL Assistant · V16.2</title>
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
${jsBundle}
  </script>
</body>
</html>
`;

  await writeFile(path.join(distDir, 'index.html'), html, 'utf8');
  console.log(`Build complete: dist/index.html (${(html.length / 1024).toFixed(0)} KB, single self-contained file).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
