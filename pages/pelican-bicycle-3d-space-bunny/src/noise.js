/**
 * noise.js —— 程序化生成的水面法线贴图（两通道波浪图） + 帆布/岩石细节贴图。
 *
 * 没有一张外部图片资源：所有贴图都在加载时算出来。
 * 水法线图用「三个不同频率/方向的正弦波叠加 + 有限差分求法线」，
 * 配合水材质里的两层不同 UV 缩放与反向流动，就有了不重复的波纹推拉感。
 */
import * as THREE from 'three';
import { clamp01, makeFbm2D, makeRng, TAU } from './util.js';

/** 把高度场转成 RGB 法线贴图（DataTexture，可直接 map 到 MeshStandardMaterial）。 */
function heightToNormalTexture(height, w, h, strength = 2.4) {
  const data = new Uint8Array(w * h * 4);
  const idx = (x, y) => ((y + h) % h) * w + ((x + w) % w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hl = height[idx(x - 1, y)];
      const hr = height[idx(x + 1, y)];
      const hd = height[idx(x, y - 1)];
      const hu = height[idx(x, y + 1)];
      let nx = (hl - hr) * strength;
      let ny = (hd - hu) * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const o = (y * w + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** 灰度高度场（噪声叠加的正弦波）。 */
function waveHeightField(size, fbm, seed) {
  const rng = makeRng(seed);
  const waves = [];
  for (let i = 0; i < 5; i++) {
    const ang = rng() * TAU;
    const freq = 2 + i * 3.4 + rng() * 1.6;
    waves.push({
      dx: Math.cos(ang) * freq,
      dy: Math.sin(ang) * freq,
      amp: 1 / (1 + i * 1.15),
      speed: 0.55 + i * 0.22,
    });
  }
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let s = 0;
      for (const w of waves) s += w.amp * Math.sin((u * w.dx + v * w.dy) * TAU + w.speed * 6.0);
      // 叠一层低频噪声，避免整体过于规整
      s += 0.42 * (fbm(u * 5.5, v * 5.5) - 0.5);
      h[y * size + x] = s;
    }
  }
  return h;
}

/**
 * 生成一对水面法线贴图（大浪 / 小涟漪）。
 * 返回的贴图会被 Water 材质和自研水色/泡沫 shader 共用。
 */
export function makeWaterNormals(renderer) {
  const size = 256;
  const fbm = makeFbm2D(91, 4);
  const big = heightToNormalTexture(waveHeightField(size, fbm, 11), size, size, 2.1);
  const ripple = heightToNormalTexture(waveHeightField(size, makeFbm2D(37, 3), 202), size, size, 3.4);
  for (const t of [big, ripple]) {
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  return { big, ripple };
}

/** 帆布/帆布包纹理：斜纹编织 + 随机污渍，返回 {map, roughnessMap, bumpMap}。 */
export function makeCanvasTextures(size = 256) {
  const rng = makeRng(404);
  const col = document.createElement('canvas');
  col.width = col.height = size;
  const bump = document.createElement('canvas');
  bump.width = bump.height = size;
  const cx = col.getContext('2d');
  const bx = bump.getContext('2d');
  const img = cx.createImageData(size, size);
  const bimg = bx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 斜纹：两组正交条纹叠加
      const warp = Math.sin((x * 0.9 + y * 0.35) * 1.6) * 0.5 + 0.5;
      const weft = Math.sin((y * 0.9 - x * 0.28) * 1.6) * 0.5 + 0.5;
      const weave = warp * 0.55 + weft * 0.45;
      const grain = rng() * 0.12;
      const stain = Math.pow(rng(), 3) * 0.25;
      const v = clamp01(0.62 + (weave - 0.5) * 0.34 + grain - stain);
      const r = 232 * v + 12;
      const g = 226 * v + 12;
      const b = 210 * v + 14;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
      const bv = clamp01(0.42 + (weave - 0.5) * 0.5 + grain) * 255;
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = bv;
      bimg.data[i + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  bx.putImageData(bimg, 0, 0);
  const map = new THREE.CanvasTexture(col);
  const bumpMap = new THREE.CanvasTexture(bump);
  for (const t of [map, bumpMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  bumpMap.colorSpace = THREE.NoColorSpace;
  return { map, bumpMap };
}

/** 岩石：灰蓝底 + 噪声斑驳 + 裂纹，兼作颜色/粗糙度/凹凸。 */
export function makeRockTexture(size = 512, seed = 5) {
  const rng = makeRng(seed);
  const fbm = makeFbm2D(seed + 3, 5);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;
      const n = fbm(u * 7.0, v * 7.0);
      const n2 = fbm(u * 21.0 + 11, v * 21.0 + 7);
      const crack = Math.pow(clamp01(1 - Math.abs(fbm(u * 4.0, v * 4.0) - 0.5) * 9), 3);
      // 中灰打底，让贴图能跟 material.color 做乘法；shade 拉高一点，
      // 否则叠加深色 tint 之后地面会黑成一片。
      let shade = 0.46 + n * 0.40 + n2 * 0.14 - crack * 0.26;
      shade = clamp01(shade);
      // 海岬岩：偏冷的灰蓝，带铁锈色氧化斑
      const rust = Math.pow(clamp01(fbm(u * 12.5 + 41, v * 12.5 + 3)), 6) * 0.9;
      const r = 118 * shade + 90 * rust;
      const g = 124 * shade + 52 * rust;
      const b = 132 * shade + 26 * rust;
      img.data[i] = Math.min(255, r);
      img.data[i + 1] = Math.min(255, g);
      img.data[i + 2] = Math.min(255, b);
      img.data[i + 3] = 255;
      // 高频砂砾
      const grit = (rng() - 0.5) * 26;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + grit));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + grit));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + grit));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 沥青/石板路面：颗粒 + 石块拼缝。返回 {map, bump}。 */
export function makeAsphaltTexture(size = 512, seed = 17) {
  const rng = makeRng(seed);
  const fbm = makeFbm2D(seed, 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  // 底色用中性中灰（~0.55），不用深色。
  // 原因：材质上的 color 是乘在这张图上的。之前底色 #2c2f36（≈0.17）
  // 乘上任何 roadColor 都会掉到 ~0.1，路面上看起来就是一块死黑。
  // 现在底色归一到中灰，真正的沥青深浅由 material.color 决定。
  ctx.fillStyle = '#8e8e8e';
  ctx.fillRect(0, 0, size, size);
  // 石块拼缝（错缝砖）
  const rows = 8;
  const cell = size / rows;
  ctx.strokeStyle = 'rgba(38,40,46,0.9)';
  ctx.lineWidth = 2.2;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * cell * 0.5;
    for (let c = -1; c <= rows; c++) {
      const x = c * cell + offset;
      const y = r * cell;
      ctx.strokeRect(x, y, cell, cell);
    }
  }
  // 颗粒
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbm(x / size * 9, y / size * 9) * 30 - 12;
      const g = (rng() - 0.5) * 34 + n;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + g));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + g));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + g * 1.1));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  /**
   * bump 必须单独生成，而且不能带拼缝。
   * 原因：bumpMap 只取红通道做屏幕空间求导，彩色贴图里的黑色砖缝
   * 会在每个像素上产生巨大的梯度，整片路面会被推成发白的伪法线。
   * 所以这里只给平滑的颗粒起伏，并且保持线性色彩空间。
   */
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = bumpCanvas.height = size;
  const bx = bumpCanvas.getContext('2d');
  const bimg = bx.createImageData(size, size);
  const grain = makeRng(seed + 991);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const g = fbm((x / size) * 14, (y / size) * 14) * 0.55 + (grain() - 0.5) * 0.45;
      const v = Math.max(0, Math.min(255, 128 + g * 90));
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = v;
      bimg.data[i + 3] = 255;
    }
  }
  bx.putImageData(bimg, 0, 0);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;

  return { map: tex, bump };
}

/** 羽细节：用作鹈鹕羽毛的粗糙度/凹凸（白羽上的细微层次）。 */
export function makeFeatherTexture(size = 256) {
  const rng = makeRng(777);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;
      // 一排排斜向羽干
      const row = v * 26;
      const rowIdx = Math.floor(row);
      const inRow = row - rowIdx;
      const skew = (u * 1.4 + rowIdx * 0.37) % 1;
      const shaft = Math.pow(1 - Math.abs(skew - 0.5) * 2, 8);
      const edge = smooth01(0.02, 0.14, inRow) * smooth01(0.02, 0.14, 1 - inRow);
      const v2 = clamp01(0.55 + shaft * 0.5 + (rng() - 0.5) * 0.1) * (0.55 + 0.45 * edge);
      const b = v2 * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function smooth01(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}