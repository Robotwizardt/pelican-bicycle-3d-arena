/**
 * util.js —— 通用数学与工具函数
 * 纯 ESM，无依赖。整个项目里最容易复用的那一层。
 */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (a, b, v) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, v) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** 帧率无关的指数趋近：rate 越大追得越快。 */
export const damp = (current, target, rate, dt) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/** 角度最短路插值（弧度）。 */
export const dampAngle = (current, target, rate, dt) =>
  current + shortAngle(current, target) * (1 - Math.exp(-rate * dt));

export const shortAngle = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/** 把 0..range 循环到 0..range。 */
export const wrap = (v, range) => ((v % range) + range) % range;

export const randRange = (a, b) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** 尖峰脉冲：t∈[0,1]，t=0 时为 1，t=1 时为 0，中间带过冲感。 */
export const spike = (t) => {
  if (t <= 0 || t >= 1) return 0;
  return Math.pow(Math.sin(Math.PI * t), 2) * (1 + 0.55 * Math.sin(Math.PI * 3 * t));
};

/** 环形缓冲 + 指数平滑，用来平滑每帧变化的数值（转向角、踏频等）。 */
export class Ring {
  constructor(size = 8) {
    this.buf = new Float32Array(size);
    this.n = 0;
    this.i = 0;
  }
  push(v) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    this.n = Math.min(this.n + 1, this.buf.length);
    return v;
  }
  get avg() {
    if (this.n === 0) return 0;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.buf[k];
    return s / this.n;
  }
  /** 样本的方差 */
  get variance() {
    if (this.n < 2) return 0;
    const m = this.avg;
    let s = 0;
    for (let k = 0; k < this.n; k++) {
      const d = this.buf[k] - m;
      s += d * d;
    }
    return s / this.n;
  }
}

/** 确定性伪随机（同一 seed 每次刷新结果一致），保证海面/岩壁可复现。 */
export function makeRng(seed = 1337) {
  let s = seed >>> 0;
  return function rng() {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** 2D 值噪声（双线性插值的哈希格点噪声），用于岩石位移等静态细节。 */
export function makeValueNoise2D(seed = 7) {
  const rng = makeRng(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const at = (x, y) => table[(y & 255) * size + (x & 255)];
  return function noise2D(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

/** 分形叠加噪声。 */
export function makeFbm2D(seed = 7, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  const n = makeValueNoise2D(seed);
  return function fbm(x, y) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
      sum += n(fx, fy) * amp;
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fy *= lacunarity;
    }
    return sum / norm;
  };
}

export const formatNum = (v, digits = 0) =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });