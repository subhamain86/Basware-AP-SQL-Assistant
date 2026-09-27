// Converts the tsc-compiled ES-module output (dist/assets/**/*.js, using
// import/export syntax with explicit .js extensions) into a SINGLE plain
// (non-module) JavaScript file using a minimal hand-rolled CommonJS-style
// loader. This is what makes the final index.html work by plain
// double-click from disk (file://) as well as from any web server,
// because:
//   - Native ES modules (<script type="module">) are blocked by browsers
//     when loaded from file:// due to CORS, which is what caused blank
//     pages when double-clicking dist/index.html directly.
//   - A single plain <script> file (no `type="module"`, no cross-file
//     `import`) has no such restriction and works identically from
//     file://, GitHub Pages, SharePoint, or any other host.
//   - Bundling into one file also sidesteps any CDN/caching issues from
//     multiple separately-fetched chunk files.
//
// Each source module is wrapped in its own factory function keyed by its
// module path, so there is zero risk of top-level identifier collisions
// between modules (unlike naive string concatenation). Modules are
// resolved lazily via a tiny __require() with caching, mirroring how
// CommonJS/webpack bundles work, so no dependency-order sorting is
// needed — first access triggers evaluation.
const fs = require('fs');
const path = require('path');

const SRC_DIR = process.argv[2];
const OUT_FILE = process.argv[3];
const ENTRY_KEY = process.argv[4] || 'main.js';

if (!SRC_DIR || !OUT_FILE) {
  console.error('Usage: node bundle.js <dist/assets dir> <output.js> [entryKey]');
  process.exit(1);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

function toModuleKey(absFile) {
  return path.relative(SRC_DIR, absFile).split(path.sep).join('/');
}

function resolveSpecifier(currentKey, specifier) {
  const dir = path.posix.dirname(currentKey);
  let resolved = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, specifier));
  resolved = resolved.replace(/^(\.\.\/)+/, (m) => m); // keep as-is; normalize handles most cases
  if (resolved.startsWith('../')) {
    // Shouldn't happen for a well-formed internal module graph, but guard anyway.
    resolved = resolved.replace(/^\.+\//, '');
  }
  if (!resolved.endsWith('.js')) resolved += '.js';
  return resolved;
}

const files = walk(SRC_DIR);
const factories = [];
let totalExportNames = 0;
let totalImports = 0;

for (const absFile of files) {
  const moduleKey = toModuleKey(absFile);
  let content = fs.readFileSync(absFile, 'utf8');

  // 1) Handle `export * from './x.js';` (barrel re-exports, e.g. types/index.js)
  content = content.replace(/^export\s+\*\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, spec) => {
    const target = resolveSpecifier(moduleKey, spec);
    return `Object.assign(exports, __require(${JSON.stringify(target)}));`;
  });

  // 2) Strip no-op `export {};` isolatedModules markers.
  content = content.replace(/^export\s*\{\s*\};?\s*$/gm, '');

  // 3) Collect exported top-level names BEFORE stripping the `export` keyword.
  const exportedNames = new Set();
  const nameCaptureRe = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let nm;
  while ((nm = nameCaptureRe.exec(content))) exportedNames.add(nm[1]);
  totalExportNames += exportedNames.size;

  // 4) Strip the leading `export ` keyword from declarations (keeps everything else on the line intact).
  content = content.replace(/^export\s+(async\s+function|function|class|const|let|var)\b/gm, '$1');

  // 5) Rewrite `import ... from '...';` into `const {...} = __require('...');`
  const importRe = /import\s+(\{[\s\S]*?\}|\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*|[A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]+)['"];?/g;
  content = content.replace(importRe, (_m, group, spec) => {
    const target = resolveSpecifier(moduleKey, spec);
    totalImports += 1;
    const targetJson = JSON.stringify(target);
    if (group.startsWith('{')) {
      const inner = group.slice(1, -1);
      const parts = inner.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
        const asMatch = entry.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
        if (asMatch) return `${asMatch[1]}: ${asMatch[2]}`;
        return entry;
      });
      return `const { ${parts.join(', ')} } = __require(${targetJson});`;
    }
    if (group.startsWith('*')) {
      const asMatch = group.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      const localName = asMatch ? asMatch[1] : '_ns';
      return `const ${localName} = __require(${targetJson});`;
    }
    // Bare default import (not used in this codebase, handled defensively).
    return `const ${group} = __require(${targetJson}).default;`;
  });

  // 6) Append explicit export assignment for every collected name.
  if (exportedNames.size) {
    content += `\nObject.assign(exports, { ${Array.from(exportedNames).join(', ')} });\n`;
  }

  factories.push({ key: moduleKey, body: content });
}

const harnessTop = `(function () {\n  "use strict";\n  var __factories = Object.create(null);\n  var __cache = Object.create(null);\n  function __require(key) {\n    if (__cache[key]) return __cache[key].exports;\n    var mod = { exports: {} };\n    __cache[key] = mod;\n    var factory = __factories[key];\n    if (!factory) { throw new Error('SQL Assistant bundle: module not found: ' + key); }\n    factory(mod, mod.exports);\n    return mod.exports;\n  }\n`;

const factoryBlocks = factories.map((f) => {
  return `  __factories[${JSON.stringify(f.key)}] = function (module, exports) {\n${f.body.split('\n').map((l) => '    ' + l).join('\n')}\n  };\n`;
}).join('\n');

const harnessBottom = `\n  // Expose the loader for diagnostics/testing (harmless in production).\n  if (typeof globalThis !== 'undefined') { globalThis.__SQLA_REQUIRE__ = __require; }\n  function __start() { __require(${JSON.stringify(ENTRY_KEY)}); }\n  if (typeof document !== 'undefined' && document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', __start);\n  } else {\n    __start();\n  }\n})();\n`;

const finalOutput = harnessTop + factoryBlocks + harnessBottom;
fs.writeFileSync(OUT_FILE, finalOutput);
console.log(`Bundled ${files.length} module(s), ${totalImports} import statement(s) rewritten, ${totalExportNames} exported name(s) tracked.`);
console.log(`Output written to ${OUT_FILE} (${(finalOutput.length / 1024).toFixed(1)} KB).`);
