/**
 * build.mjs — 把 src/ 打成【单个自包含 HTML】（无外部请求，可离线打开）
 *   1) esbuild 把 src/main.js 及其依赖打成 IIFE（含 three.js）
 *   2) 把 CSS 与 JS 内联进 src/index.html 的占位符
 *   3) 输出 dist/index.html
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(root, 'dist/index.html');

const banner = `/* 鹈鹕骑士 3D · Pelican Rider — model: deepseek-v4.1-flash
   程序化几何 / 两级解析 IK / 自研 HDR 后期 / 昼夜与潮汐 / 全合成音效
   单文件构建：three.js 已内联，无任何外部资源请求。 */`;

const res = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true, format: 'iife', target: ['es2020'], minify: true,
  legalComments: 'none', charset: 'utf8', write: false, banner: { js: banner },
  logLevel: 'info',
});

const js = res.outputFiles[0].text.replaceAll('</script', '<\\/script');
const css = (await readFile(resolve(root, 'src/styles.css'), 'utf8')).trim();
let html = await readFile(resolve(root, 'src/index.html'), 'utf8');

if (!html.includes('<!--INLINE_CSS-->') || !html.includes('<!--INLINE_JS-->')) {
  throw new Error('index.html 缺少 <!--INLINE_CSS--> / <!--INLINE_JS--> 占位符');
}
// 注意：必须用函数式替换（否则 bundle 里的 $& / $` 会被当成分组引用，破坏内联脚本）
const cssTag = `<style>\n${css}\n</style>`;
const jsTag = `<script>\n${js}\n</script>`;
html = html
  .replace('<!--INLINE_CSS-->', () => cssTag)
  .replace('<!--INLINE_JS-->', () => jsTag)
  .replace('%BUILD_TIME%', () => new Date().toISOString().slice(0, 16).replace('T', ' '));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`\n✅ dist/index.html  ${kb(html.length)}（gzip 后 ${kb(gzipSync(html, { level: 9 }).length)}）`);
console.log(`   其中 JS ${kb(js.length)} · CSS ${kb(css.length)}`);
