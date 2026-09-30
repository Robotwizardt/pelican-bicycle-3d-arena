#!/usr/bin/env node
/* 生成单文件版本 pelican-ride.html（内联 three/OrbitControls/app，便于任意 CDN 托管） */
const fs = require('fs');
const path = require('path');
const root = __dirname;

let html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const inline = (src) => fs.readFileSync(path.join(root, 'dist', src), 'utf8')
  .replace(/<\/script>/gi, '<\\/script>');

for (const src of ['three.min.js', 'OrbitControls.js', 'app.js']) {
  const tag = `<script src="${src}"></script>`;
  if (!html.includes(tag)) { console.error('missing tag for ' + src); process.exit(1); }
  html = html.replace(tag, `<script>\n${inline(src)}\n</script>`);
}
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
const out = path.join(root, 'release', 'pelican-ride.html');
fs.writeFileSync(out, html);
console.log(`single-file ok: release/pelican-ride.html ${(fs.statSync(out).size / 1024).toFixed(0)}KB`);
