#!/usr/bin/env node
/* 构建脚本：拼接 src/app*.js -> 压缩 -> dist/app.js */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = __dirname;
const parts = ['src/app.js', 'src/app2.js', 'src/app3.js'];
const bundle = parts.map(p => fs.readFileSync(path.join(root, p), 'utf8')).join('\n');
fs.writeFileSync(path.join(root, 'src/app.bundle.js'), bundle);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'app.js');
try {
  execSync(`npx terser "${path.join(root, 'src/app.bundle.js')}" -c -m -o "${out}"`, { stdio: 'inherit', cwd: root });
} catch (e) { process.exit(1); }
for (const v of ['three.min.js','OrbitControls.js']) fs.copyFileSync(path.join(root, 'vendor/' + v), path.join(root, 'dist/' + v));
fs.copyFileSync(path.join(root, 'index.html'), path.join(root, 'dist/index.html'));
const kb = (fs.statSync(out).size / 1024).toFixed(1);
const raw = (Buffer.byteLength(bundle) / 1024).toFixed(1);
console.log(`build ok: dist/app.js ${kb}KB (raw ${raw}KB), dist/three.min.js ${(fs.statSync(path.join(root, 'dist/three.min.js')).size/1024).toFixed(0)}KB`);
