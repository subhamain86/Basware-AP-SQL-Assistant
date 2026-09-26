import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
let js = fs.readFileSync(path.join(distDir, 'assets', 'app.js'), 'utf-8');
const css = fs.readFileSync(path.join(distDir, 'assets', 'app.css'), 'utf-8');
const favicon = fs.readFileSync(path.join(distDir, 'favicon.svg'), 'utf-8');
const faviconDataUri = `data:image/svg+xml;base64,${Buffer.from(favicon, 'utf-8').toString('base64')}`;

// ---------------------------------------------------------------------
// Defense #1: escape any literal "</script" sequence in the bundle so the
// browser's HTML tokenizer can never prematurely close our <script> tag,
// even if such a sequence appears inside a JS string/comment.
// ---------------------------------------------------------------------
const scriptCloseOccurrences = (js.match(/<\/script/gi) || []).length;
js = js.replace(/<\/script/gi, '<\\/script');
console.log(`Escaped ${scriptCloseOccurrences} occurrence(s) of "</script" in the bundle.`);

// ---------------------------------------------------------------------
// Defense #2 (the actual bug hit this run): String.prototype.replace()
// treats $&, $`, $', $$, $<n> as SPECIAL REPLACEMENT PATTERNS whenever the
// replacement argument is a STRING. Minified JS commonly contains a
// single-letter variable named `$` (e.g. `$&&foo` or `$'+bar`), which is
// then misinterpreted as one of these patterns, silently corrupting the
// output. THE FIX: always pass a FUNCTION as the second argument to
// .replace() — function-based replacements are inserted completely
// literally, with zero special-pattern interpretation, regardless of what
// characters they contain.
// ---------------------------------------------------------------------
let out = html
  .replace('<script type="module" crossorigin src="./assets/app.js"></script>', () => `<script type="module">\n${js}\n</script>`)
  .replace('<link rel="stylesheet" crossorigin href="./assets/app.css">', () => `<style>\n${css}\n</style>`)
  .replace('<link rel="icon" type="image/svg+xml" href="./favicon.svg" />', () => `<link rel="icon" type="image/svg+xml" href="${faviconDataUri}" />`);

fs.writeFileSync(path.join(distDir, 'index.html'), out, 'utf-8');
console.log('Inlined into dist/index.html —', (out.length / 1024).toFixed(1), 'KB, zero external references.');
fs.rmSync(path.join(distDir, 'assets'), { recursive: true, force: true });
fs.rmSync(path.join(distDir, 'favicon.svg'), { force: true });
console.log('Removed separate assets/ + favicon.svg.');

// ---------------------------------------------------------------------
// Verification: (a) the script body must be byte-identical in length to
// what we intended to insert (catches $-pattern corruption), and (b) the
// script body must contain zero unescaped "</script" sequences.
// ---------------------------------------------------------------------
const finalHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
const scriptStart = finalHtml.indexOf('<script type="module">') + '<script type="module">'.length;
const scriptEnd = finalHtml.lastIndexOf('</script>');
const scriptBody = finalHtml.slice(scriptStart, scriptEnd);
const expectedBody = `\n${js}\n`;

if (scriptBody !== expectedBody) {
  console.error('VERIFICATION FAILED: the inlined script body does not exactly match the intended JS bundle.');
  console.error('Expected length:', expectedBody.length, 'Actual length:', scriptBody.length);
  process.exit(1);
}
const leftoverCount = (scriptBody.match(/<\/script/gi) || []).length;
if (leftoverCount > 0) {
  console.error(`VERIFICATION FAILED: ${leftoverCount} unescaped "</script" sequence(s) remain inside the script body!`);
  process.exit(1);
}
console.log('VERIFIED: script body is byte-identical to the intended bundle, zero "</script" sequences. Safe to ship.');
