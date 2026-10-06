/** Bundle KaTeX's stylesheet and WOFF2 fonts for offline VS Code webviews. */
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('katex/dist/katex.min.css'));
const output = new URL('../dist/math/', import.meta.url);
await mkdir(new URL('fonts/', output), { recursive: true });
let css = await readFile(join(dist, 'katex.min.css'), 'utf8');
css = css.replace(/src:([^;}]+)/g, (declaration, sources) => {
  const woff2 = sources.split(',').find((source) => source.includes('.woff2'));
  return woff2 ? `src:${woff2}` : declaration;
});
for (const match of css.matchAll(/url\(fonts\/([^)]*\.woff2)\)/g)) await cp(join(dist, 'fonts', match[1]), new URL(`fonts/${match[1]}`, output));
await writeFile(new URL('katex.css', output), css);
console.log('Bundled KaTeX CSS and WOFF2 fonts.');
