#!/usr/bin/env node
/**
 * tools/build.mjs —— 把 src/*.js + three 打包成 js/bundle.js（IIFE 单文件）
 *
 * 为什么需要这一步：
 *  - 直接双击 index.html（file:// 协议）时，浏览器会用 CORS 拦掉 ES module 的 import。
 *    打成 IIFE 之后没有任何 import/export，file:// 也能直接跑。
 *  - three 一起打进去 → 页面不依赖任何 CDN，断网可玩。
 *
 * 用法（发布产物里已含成品 js/bundle.js，读者无需运行本脚本）：
 *   pnpm add -D esbuild && pnpm add three
 *   node tools/build.mjs            # 开发版（可读）
 *   node tools/build.mjs --min      # 压缩版
 *
 * 想在别处复用已装好的依赖时：
 *   BUILD_CWD=<装有 node_modules 的目录> THREE_PATH=<three 包目录> node tools/build.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { existsSync, statSync, readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 依赖解析基准目录：默认项目自身，可用 BUILD_CWD 指向别处已装好的 node_modules
const depRoot = resolve(process.env.BUILD_CWD || root);
const req = createRequire(join(depRoot, '__resolve__.js'));

/** 动态载入 esbuild（允许它来自 depRoot 下的 node_modules） */
async function loadEsbuild() {
  const mod = req.resolve('esbuild');
  return import(pathToFileURL(mod).href);
}
const { build } = await loadEsbuild();

/** 定位 three 包目录：显式参数 > BUILD_CWD/node_modules > 项目 node_modules */
function resolveThreeRoot() {
  const fromCli = process.argv.find((a) => a.startsWith('--three='));
  const candidates = [
    process.env.THREE_PATH && resolve(process.env.THREE_PATH),
    fromCli && resolve(fromCli.slice('--three='.length)),
    join(depRoot, 'node_modules', 'three'),
    join(root, 'node_modules', 'three'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, 'build', 'three.module.js'))) return c;
  }
  throw new Error('找不到 three：请 pnpm add three，或用 --three=<路径> 指定');
}

const THREE_PATH = resolveThreeRoot();
const THREE_VERSION = JSON.parse(readFileSync(join(THREE_PATH, 'package.json'), 'utf8')).version;

const out = resolve(root, 'js/bundle.js');
await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'firefox100', 'safari16'],
  minify: process.argv.includes('--min'),
  sourcemap: false,
  legalComments: 'none',
  outfile: out,
  // 不配 alias：three 包自身的 exports 映射已把 'three' 和 'three/addons/*' 处理好，
  // nodePaths 指向装了 three 的目录即可（见 tools/build.mjs 头部的 BUILD_CWD 说明）。
  nodePaths: [join(depRoot, 'node_modules')],
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
});

console.log(
  `\n✅ 打包完成: js/bundle.js  ${(statSync(out).size / 1024).toFixed(0)} KB  (three r${THREE_VERSION})`
);