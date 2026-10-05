// 贴图与渐变资源
import * as THREE from 'three';

export const Assets = {
  wood: null,          // 木板路贴图（CanvasTexture 程序生成）
  painting: null,      // 画廊挂画（AI 生成，可选）
  featherNormal: null, // 鹈鹕羽毛法线（AI 生成，可选）
  skyDay: null, skyNight: null,
  particle: null,
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// 程序生成木纹（AI 木板贴图加载失败时兜底，保证离线可用）
function proceduralWood() {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#8a6b4a';
  ctx.fillRect(0, 0, 512, 512);
  const plank = 512 / 6;
  for (let i = 0; i < 6; i++) {
    const y = i * plank;
    const base = 120 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${base + 30},${base - 10},${base - 45})`;
    ctx.fillRect(0, y, 512, plank - 3);
    // 木纹
    for (let g = 0; g < 26; g++) {
      ctx.strokeStyle = `rgba(60,40,20,${0.05 + Math.random() * 0.1})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const gy = y + Math.random() * plank;
      ctx.moveTo(0, gy);
      for (let x = 0; x <= 512; x += 32) {
        ctx.lineTo(x, gy + Math.sin(x * 0.02 + g) * 3 + (Math.random() - 0.5) * 2);
      }
      ctx.stroke();
    }
    // 板缝
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, y + plank - 3, 512, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 竖向渐变天空
function gradientSky(stops) {
  const [c, ctx] = makeCanvas(16, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  for (const [t, col] of stops) g.addColorStop(t, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 粒子贴图
function softDot() {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export async function loadAssets(onOne) {
  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((res) => {
    loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null));
  });

  Assets.skyDay = gradientSky([
    [0.0, '#3d7ac8'], [0.45, '#7fb4e0'], [0.75, '#cfe4ee'], [1.0, '#ffe3c2'],
  ]);
  Assets.skyNight = gradientSky([
    [0.0, '#04070f'], [0.5, '#0a1226'], [0.8, '#16243d'], [1.0, '#2a3a55'],
  ]);
  Assets.particle = softDot();

  Assets.wood = proceduralWood();
  onOne?.('木纹（程序生成）');

  // AI 生成的贴图是增强项，失败不阻塞
  Assets.painting = await load('assets/textures/pelican-canvas-painting.jpg');
  onOne?.(Assets.painting ? '画廊挂画（AI）' : '挂画缺失');
  Assets.featherNormal = await load('assets/textures/pelican-normal-map.jpg');
  if (Assets.featherNormal) {
    Assets.featherNormal.wrapS = Assets.featherNormal.wrapT = THREE.RepeatWrapping;
  }
  onOne?.(Assets.featherNormal ? '羽毛法线（AI）' : '法线缺失');
}
