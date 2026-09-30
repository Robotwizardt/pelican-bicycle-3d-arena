/* =====================================================================
 * materials.js — 全部贴图都用 Canvas 程序化生成，零外部资源
 * 全局命名空间 PB.Tex / PB.Mat
 * ===================================================================*/
(function () {
  'use strict';
  var PB = window.PB, U = PB.U;

  /* ---------- 可平铺（周期性）值噪声 ---------- */
  function pnoise(x, y, period) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    function h(a, b) {
      a = ((a % period) + period) % period;
      b = ((b % period) + period) % period;
      var n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
      return n - Math.floor(n);
    }
    var a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  }
  function pfbm(x, y, oct, basePeriod) {
    var s = 0, amp = 0.5, f = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      s += amp * (pnoise(x * f, y * f, basePeriod * f) * 2 - 1);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return s / norm;
  }

  function canvas(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }
  function tex(c, opts) {
    opts = opts || {};
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = opts.aniso || 8;
    t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    t.needsUpdate = true;
    return t;
  }

  var cache = {};
  function memo(key, fn) {
    if (!cache[key]) cache[key] = fn();
    return cache[key];
  }

  /** 从高度场生成法线贴图（Sobel） */
  function heightToNormal(height, size, strength) {
    var c = canvas(size), ctx = c.getContext('2d');
    var img = ctx.createImageData(size, size);
    var d = img.data;
    var at = function (x, y) { return height[((y + size) % size) * size + ((x + size) % size)]; };
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        var dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        var len = Math.sqrt(dx * dx + dy * dy + 1);
        var i = (y * size + x) * 4;
        d[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  var Tex = {
    /* ---------- 沙滩：色斑 + 沙纹 + 颗粒 ---------- */
    sand: function (size) {
      return memo('sand' + size, function () {
        size = size || 512;
        var c = canvas(size), ctx = c.getContext('2d');
        var img = ctx.createImageData(size, size), d = img.data;
        var h = new Float32Array(size * size);
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            var u = x / size * 6, v = y / size * 6;
            var dune = pfbm(u * 1.6, v * 1.6, 4, 6) * 0.5 + 0.5;
            var ripple = Math.sin((u * 26 + pfbm(u * 3, v * 3, 3, 6) * 5)) * 0.5 + 0.5;
            var grain = pnoise(x / size * size, y / size * size, size);
            var t = dune * 0.6 + ripple * 0.22 + grain * 0.18;
            h[y * size + x] = t;
            var i = (y * size + x) * 4;
            // 沙色渐变：湿沙偏暗偏棕，干沙偏亮偏金
            var wet = U.smoothstep(0.35, 0.75, dune);
            var r = U.lerp(196, 232, t) * U.lerp(1, 0.86, wet);
            var g = U.lerp(172, 210, t) * U.lerp(1, 0.9, wet);
            var b = U.lerp(133, 172, t) * U.lerp(1, 0.98, wet);
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        Tex._sandH = h;
        return tex(c);
      });
    },
    sandNormal: function (size) {
      Tex.sand(size);
      return memo('sandN' + size, function () {
        return tex(heightToNormal(Tex._sandH, size, size * 0.05), { linear: true });
      });
    },

    /* ---------- 海面法线：两层 fbm 叠加 ---------- */
    waterNormal: function (size) {
      return memo('waterN' + size, function () {
        size = size || 256;
        var h = new Float32Array(size * size);
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            var u = x / size * 4, v = y / size * 4;
            var a = pfbm(u, v, 4, 4);
            var b = pfbm(u * 2.7 + 11.3, v * 2.7 - 4.1, 3, 8);
            h[y * size + x] = a * 0.65 + b * 0.35;
          }
        }
        return tex(heightToNormal(h, size, size * 0.09), { linear: true });
      });
    },

    /* ---------- 泡沫：软斑点，可平铺 ---------- */
    foam: function (size) {
      return memo('foam' + size, function () {
        size = size || 256;
        var c = canvas(size), ctx = c.getContext('2d');
        var img = ctx.createImageData(size, size), d = img.data;
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            var n = pfbm(x / size * 5, y / size * 5, 4, 5) * 0.5 + 0.5;
            var bubble = Math.pow(U.saturate((n - 0.52) / 0.28), 1.4);
            var i = (y * size + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = Math.round(U.saturate(bubble) * 255);
          }
        }
        ctx.putImageData(img, 0, 0);
        return tex(c);
      });
    },

    /* ---------- 羽毛：细密羽轴纹理（用作 roughnessMap / 细节） ---------- */
    feather: function (size) {
      return memo('feather' + size, function () {
        size = size || 256;
        var c = canvas(size), ctx = c.getContext('2d');
        var img = ctx.createImageData(size, size), d = img.data;
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            var v = y / size;
            // 羽轴 + 羽枝的条纹
            var shaft = Math.abs(Math.sin(x / size * Math.PI * 26 + Math.sin(v * 9) * 1.4));
            var barb = Math.abs(Math.sin(y / size * Math.PI * 34));
            var n = pfbm(x / size * 8, y / size * 8, 3, 8) * 0.5 + 0.5;
            var t = U.saturate(0.42 + shaft * 0.3 + barb * 0.2 + (n - 0.5) * 0.35);
            var i = (y * size + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = Math.round(t * 255);
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return tex(c, { linear: true });
      });
    },

    /* ---------- 环境贴图：等距圆柱投影的黄昏天空 ---------- */
    envSky: function (w) {
      return memo('envSky' + w, function () {
        w = w || 512;
        var h = w / 2;
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0.00, '#0a1a3c');
        g.addColorStop(0.32, '#2a4d84');
        g.addColorStop(0.47, '#7fa6c9');
        g.addColorStop(0.52, '#f2c48a');
        g.addColorStop(0.60, '#c98f63');
        g.addColorStop(1.00, '#3b352c');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        // 太阳
        var sx = w * 0.30, sy = h * 0.505;
        var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.34);
        sg.addColorStop(0, 'rgba(255,248,225,1)');
        sg.addColorStop(0.06, 'rgba(255,225,170,0.92)');
        sg.addColorStop(0.28, 'rgba(255,170,95,0.34)');
        sg.addColorStop(1, 'rgba(255,140,70,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
        // 稀疏云带
        var rnd = U.rng(7);
        for (var i = 0; i < 34; i++) {
          var cy = h * U.lerp(0.12, 0.47, rnd());
          var cx = w * rnd();
          var cw = w * rnd.range(0.03, 0.13), ch = h * rnd.range(0.008, 0.03);
          var alpha = rnd.range(0.04, 0.16) * (1 - Math.abs(cy / h - 0.3));
          var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw);
          cg.addColorStop(0, 'rgba(255,244,228,' + alpha.toFixed(3) + ')');
          cg.addColorStop(1, 'rgba(255,244,228,0)');
          ctx.save();
          ctx.translate(cx, cy); ctx.scale(1, ch / cw); ctx.translate(-cx, -cy);
          ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cw, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        var t = new THREE.CanvasTexture(c);
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
      });
    },

    /* ---------- 胶片颗粒（蓝噪声近似：多次随机取最小） ---------- */
    grain: function (size) {
      return memo('grain' + size, function () {
        size = size || 128;
        var c = canvas(size), ctx = c.getContext('2d');
        var img = ctx.createImageData(size, size), d = img.data;
        var rnd = U.rng(2026);
        for (var i = 0; i < size * size; i++) {
          var v = Math.min(rnd(), Math.min(rnd(), rnd())); // 偏暗的高频噪声
          var g = Math.round(v * 255);
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
          d[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        var t = tex(c, { linear: true });
        t.magFilter = t.minFilter = THREE.NearestFilter;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return t;
      });
    },

    /* ---------- 圆形软阴影贴片 ---------- */
    shadowBlob: function (size) {
      return memo('blob', function () {
        size = size || 128;
        var c = canvas(size), ctx = c.getContext('2d');
        var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(0,0,0,0.62)');
        g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
        var t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.NoColorSpace;
        return t;
      });
    },

    /* ---------- 径向光斑（体积光 / 太阳耀斑） ---------- */
    radialGlow: function (size, inner, mid) {
      return memo('glow' + size + inner + mid, function () {
        size = size || 128;
        var c = canvas(size), ctx = c.getContext('2d');
        var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,' + inner + ')');
        g.addColorStop(0.25, 'rgba(255,240,210,' + mid + ')');
        g.addColorStop(1, 'rgba(255,220,170,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
        var t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
    },

    /* ---------- 云朵贴片（柔和团块） ---------- */
    cloud: function (size) {
      return memo('cloud', function () {
        size = size || 256;
        var c = canvas(size), ctx = c.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        var rnd = U.rng(31);
        for (var i = 0; i < 26; i++) {
          var a = rnd() * Math.PI * 2, r = rnd() * size * 0.26;
          var x = size / 2 + Math.cos(a) * r, y = size / 2 + Math.sin(a) * r * 0.55;
          var rad = size * rnd.range(0.10, 0.26);
          var g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, 'rgba(255,255,255,0.32)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        }
        // 整体软化遮罩
        var m = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.5);
        m.addColorStop(0, 'rgba(0,0,0,0)');
        m.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = m; ctx.fillRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'source-over';
        var t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
    }
  };

  /* ================= 材质库 ================= */
  var Mat = {
    build: function (quality) {
      var q = quality || {};
      var env = Tex.envSky(512);
      var feather = Tex.feather(256);

      var M = {};

      M.sand = new THREE.MeshStandardMaterial({
        map: Tex.sand(512),
        normalMap: Tex.sandNormal(512),
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.94, metalness: 0.0,
        envMapIntensity: 0.35,
        dithering: true
      });
      M.sand.map.repeat.set(26, 26);
      M.sand.normalMap.repeat.set(26, 26);

      M.duneGrass = new THREE.MeshStandardMaterial({
        color: 0x7c8a4a, roughness: 0.92, metalness: 0,
        envMapIntensity: 0.3
      });

      M.rock = new THREE.MeshStandardMaterial({
        color: 0x8b8577, roughness: 0.86, metalness: 0.02,
        envMapIntensity: 0.4, flatShading: false
      });

      // ---- 鹈鹕 ----
      M.body = new THREE.MeshPhysicalMaterial({
        color: 0xf4f6fa, roughness: 0.58, metalness: 0.0,
        roughnessMap: feather,
        sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xdfe9f5),
        clearcoat: 0.12, clearcoatRoughness: 0.7,
        envMapIntensity: 0.85
      });
      M.wing = new THREE.MeshPhysicalMaterial({
        color: 0xe9edf4, roughness: 0.62, metalness: 0.0,
        roughnessMap: feather,
        sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xd8e4f2),
        envMapIntensity: 0.8, side: THREE.DoubleSide
      });
      M.wingTip = new THREE.MeshStandardMaterial({
        color: 0x3a4152, roughness: 0.5, metalness: 0.05, envMapIntensity: 0.7, side: THREE.DoubleSide
      });
      M.pouch = new THREE.MeshPhysicalMaterial({
        color: 0xf2a03c, roughness: 0.42, metalness: 0.0,
        transmission: 0.28, thickness: 0.4, ior: 1.35,
        clearcoat: 0.5, clearcoatRoughness: 0.3,
        sheen: 0.4, envMapIntensity: 0.9,
        side: THREE.DoubleSide
      });
      M.beak = new THREE.MeshPhysicalMaterial({
        color: 0xf0b23f, roughness: 0.3, metalness: 0.05,
        clearcoat: 0.7, clearcoatRoughness: 0.22, envMapIntensity: 1.0
      });
      M.beakNail = new THREE.MeshPhysicalMaterial({
        color: 0xd8622f, roughness: 0.26, metalness: 0.05,
        clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 1.0
      });
      M.leg = new THREE.MeshStandardMaterial({
        color: 0xe08a3a, roughness: 0.55, metalness: 0.0,
        envMapIntensity: 0.7
      });
      M.foot = new THREE.MeshStandardMaterial({
        color: 0xe89a45, roughness: 0.5, metalness: 0.0,
        envMapIntensity: 0.7, side: THREE.DoubleSide
      });
      M.eyeWhite = new THREE.MeshPhysicalMaterial({
        color: 0xfbfdff, roughness: 0.12, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2
      });
      M.eye = new THREE.MeshPhysicalMaterial({
        color: 0x120c07, roughness: 0.06, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6
      });
      M.crest = new THREE.MeshStandardMaterial({
        color: 0xfdfbf4, roughness: 0.65, metalness: 0, envMapIntensity: 0.8, side: THREE.DoubleSide
      });

      // ---- 自行车 ----
      M.frame = new THREE.MeshPhysicalMaterial({
        color: 0x1d2b4a, roughness: 0.28, metalness: 0.55,
        clearcoat: 0.85, clearcoatRoughness: 0.14, envMapIntensity: 1.1
      });
      M.chrome = new THREE.MeshStandardMaterial({
        color: 0xd8dde4, roughness: 0.12, metalness: 1.0, envMapIntensity: 1.4
      });
      M.tire = new THREE.MeshStandardMaterial({
        color: 0x1a1c20, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.4
      });
      M.tireStripe = new THREE.MeshStandardMaterial({
        color: 0xd9d3c4, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.5
      });
      M.rim = new THREE.MeshStandardMaterial({
        color: 0xb9c0c9, roughness: 0.22, metalness: 0.95, envMapIntensity: 1.3
      });
      M.spoke = new THREE.MeshStandardMaterial({
        color: 0xcfd6de, roughness: 0.3, metalness: 1.0, envMapIntensity: 1.2
      });
      M.saddle = new THREE.MeshPhysicalMaterial({
        color: 0x4a2b1c, roughness: 0.45, metalness: 0.0,
        clearcoat: 0.4, clearcoatRoughness: 0.4, envMapIntensity: 0.7
      });
      M.grip = new THREE.MeshStandardMaterial({
        color: 0x24282e, roughness: 0.75, metalness: 0.0, envMapIntensity: 0.5
      });
      M.basket = new THREE.MeshStandardMaterial({
        color: 0xc79a5c, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.6,
        side: THREE.DoubleSide
      });
      M.fish = new THREE.MeshPhysicalMaterial({
        color: 0x9fd8e8, roughness: 0.22, metalness: 0.25,
        clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.3
      });
      M.fishBelly = new THREE.MeshPhysicalMaterial({
        color: 0xf5fbfd, roughness: 0.3, metalness: 0.1, envMapIntensity: 1.0
      });
      M.chain = new THREE.MeshStandardMaterial({
        color: 0x8d949c, roughness: 0.35, metalness: 1.0, envMapIntensity: 1.2
      });

      // ---- 配件 ----
      M.helmet = new THREE.MeshPhysicalMaterial({
        color: 0xffc94d, roughness: 0.24, metalness: 0.1,
        clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.2
      });
      M.helmetStripe = new THREE.MeshStandardMaterial({
        color: 0x2a2f38, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.9
      });
      M.scarf = new THREE.MeshStandardMaterial({
        color: 0xe94f5c, roughness: 0.85, metalness: 0.0,
        envMapIntensity: 0.5, side: THREE.DoubleSide
      });
      M.glassBottle = new THREE.MeshPhysicalMaterial({
        color: 0xa8e0d8, roughness: 0.08, metalness: 0,
        transmission: 0.92, thickness: 0.5, ior: 1.5,
        transparent: true, opacity: 1, envMapIntensity: 1.2
      });
      M.sandwich = new THREE.MeshStandardMaterial({
        color: 0xe8c98a, roughness: 0.85, metalness: 0, envMapIntensity: 0.5
      });

      // ---- 环境 ----
      M.palmTrunk = new THREE.MeshStandardMaterial({
        color: 0x7d6244, roughness: 0.9, metalness: 0, envMapIntensity: 0.4
      });
      M.palmLeaf = new THREE.MeshStandardMaterial({
        color: 0x4f7a3a, roughness: 0.82, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide
      });
      M.seagull = new THREE.MeshStandardMaterial({
        color: 0xf2f4f8, roughness: 0.7, metalness: 0, envMapIntensity: 0.7
      });
      M.lighthouseBody = new THREE.MeshStandardMaterial({
        color: 0xf3f0e8, roughness: 0.7, metalness: 0, envMapIntensity: 0.6
      });
      M.lighthouseBand = new THREE.MeshStandardMaterial({
        color: 0xd94b3f, roughness: 0.65, metalness: 0, envMapIntensity: 0.6
      });
      M.lighthouseLamp = new THREE.MeshStandardMaterial({
        color: 0xfff2c0, emissive: 0xffd98a, emissiveIntensity: 2.2, roughness: 0.3
      });
      M.star = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      M.cloudMat = new THREE.MeshBasicMaterial({
        map: Tex.cloud(256), transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.NormalBlending
      });
      M.firefly = new THREE.MeshBasicMaterial({
        color: 0xffe08a, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      M.sparkle = new THREE.MeshBasicMaterial({
        color: 0xfff4d0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      });

      M._env = env;
      M._feather = feather;
      return M;
    }
  };

  PB.Tex = Tex;
  PB.Mat = Mat;
})();
