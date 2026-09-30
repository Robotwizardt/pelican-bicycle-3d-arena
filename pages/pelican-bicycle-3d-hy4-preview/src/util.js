/* =====================================================================
 * util.js — 数学 / 随机 / 噪声 / 曲线 / 颜色 / 轻量工具
 * 全局命名空间 PB.U
 * ===================================================================*/
(function () {
  'use strict';
  var PB = (window.PB = window.PB || {});

  var U = {
    TAU: Math.PI * 2,
    DEG: Math.PI / 180,

    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    saturate: function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); },
    smoothstep: function (e0, e1, x) {
      var t = U.saturate((x - e0) / (e1 - e0 || 1e-6));
      return t * t * (3 - 2 * t);
    },
    smootherstep: function (e0, e1, x) {
      var t = U.saturate((x - e0) / (e1 - e0 || 1e-6));
      return t * t * t * (t * (t * 6 - 15) + 10);
    },
    /** 帧率无关的指数阻尼：rate 越大跟随越快 */
    damp: function (cur, target, rate, dt) {
      // 负数 / NaN 的 dt 会让 1-exp(-rate*dt) 爆炸，从而把整个场景炸飞。
      if (!(dt > 0)) return cur;
      return U.lerp(cur, target, 1 - Math.exp(-rate * dt));
    },
    /** 角度最短路径插值 */
    dampAngle: function (cur, target, rate, dt) {
      var d = ((target - cur + Math.PI) % U.TAU + U.TAU) % U.TAU - Math.PI;
      return cur + d * (1 - Math.exp(-rate * dt));
    },
    wrap: function (v, m) { return ((v % m) + m) % m; },
    map: function (v, a, b, c, d) { return c + (d - c) * ((v - a) / (b - a || 1e-6)); },
    mix: function (a, b, t) { return a + (b - a) * t; },

    /* ---------- 确定性随机（mulberry32） ---------- */
    rng: function (seed) {
      var s = seed >>> 0;
      var f = function () {
        s = (s + 0x6D2B79F5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      f.range = function (a, b) { return a + (b - a) * f(); };
      f.int = function (a, b) { return Math.floor(a + (b - a + 1) * f()); };
      f.pick = function (arr) { return arr[Math.floor(f() * arr.length) % arr.length]; };
      f.sign = function () { return f() < 0.5 ? -1 : 1; };
      return f;
    },

    /* ---------- 2D 值噪声 + fBm ---------- */
    _perm: null,
    _hash: function (x, y) {
      var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return n - Math.floor(n);
    },
    noise2: function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y);
      var xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = U._hash(xi, yi), b = U._hash(xi + 1, yi);
      var c = U._hash(xi, yi + 1), d = U._hash(xi + 1, yi + 1);
      return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v) * 2 - 1;
    },
    fbm: function (x, y, oct, lac, gain) {
      oct = oct || 5; lac = lac || 2.03; gain = gain || 0.5;
      var s = 0, a = 0.5, f = 1, norm = 0;
      for (var i = 0; i < oct; i++) {
        s += a * U.noise2(x * f, y * f);
        norm += a; a *= gain; f *= lac;
      }
      return s / (norm || 1);
    },
    /** 脊状噪声：适合做沙丘 / 礁石 */
    ridged: function (x, y, oct) {
      var s = 0, a = 0.5, f = 1, norm = 0;
      for (var i = 0; i < (oct || 4); i++) {
        s += a * (1 - Math.abs(U.noise2(x * f, y * f)));
        norm += a; a *= 0.5; f *= 2.07;
      }
      return s / (norm || 1);
    },

    /* ---------- 颜色 ---------- */
    hex: function (h) { return new THREE.Color(h); },
    /** 把 CSS hex 字符串写进 THREE.Color（避免每帧 new） */
    setHex: function (col, hexStr) { return col.set(hexStr); },

    /* ---------- 曲线工具 ---------- */
    /** 闭合样条：点集 -> CatmullRomCurve3 */
    loopCurve: function (pts, tension) {
      return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', tension == null ? 0.5 : tension);
    },
    /** 一次性建立弧长表，用于恒定速度巡游与沿线放置物体 */
    arcTable: function (curve, samples) {
      var n = samples || 600, t = [], len = [];
      var acc = 0, prev = curve.getPoint(0);
      t[0] = 0; len[0] = 0;
      for (var i = 1; i <= n; i++) {
        var p = curve.getPoint(i / n);
        acc += p.distanceTo(prev); prev = p;
        t[i] = i / n; len[i] = acc;
      }
      return { total: acc, t: t, len: len, n: n };
    },
    /** 弧长 s -> 曲线参数 t */
    sToT: function (table, s) {
      var L = table.len, n = table.n;
      var u = U.wrap(s, table.total) / table.total * n;
      var i = Math.min(n - 1, Math.floor(u));
      var f = u - i;
      return U.lerp(L[i] !== undefined ? table.t[i] : 0, table.t[i + 1] || 1, f);
    },

    /* ---------- DOM ---------- */
    $: function (sel, root) { return (root || document).querySelector(sel); },
    $$: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    el: function (tag, cls, txt) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    },

    /* ---------- 格式化 ---------- */
    fmt1: function (v) { return (Math.round(v * 10) / 10).toFixed(1); },
    fmt0: function (v) { return Math.round(v).toString(); },
    pad2: function (v) { return (v < 10 ? '0' : '') + v; },

    /* ---------- 小工具 ---------- */
    nowMs: function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); },
    /** 把数字数组做成 Float32 缓冲几何属性 */
    attr: function (arr, itemSize) {
      return new THREE.BufferAttribute(new Float32Array(arr), itemSize);
    },
    /** 释放一棵子树的几何 / 材质（不含纹理） */
    disposeTree: function (root) {
      root.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          var m = Array.isArray(o.material) ? o.material : [o.material];
          m.forEach(function (mm) { mm.dispose(); });
        }
      });
    }
  };

  /**
   * 两骨解析 IK（余弦定理）。返回膝/肘的"弯曲方向"由 pole 决定。
   * root: 关节点世界坐标（Vector3）
   * target: 末端目标世界坐标
   * l1, l2: 两段骨长
   * pole: 参考方向（Vector3，通常指向身体的"外侧/前方"）
   * 返回值 {ok:boolean, angle1:number, angle2:number, axis:Vector3, dir:Vector3, dist:number}
   * angle1 = 第一段偏离"直指目标"方向的角度；angle2 = 第二段的弯曲角
   */
  U.twoBoneIK = function (root, target, l1, l2, pole) {
    var dir = new THREE.Vector3().subVectors(target, root);
    var dist = dir.length();
    var res = { ok: true, dist: dist, dir: dir.clone().normalize(), angle1: 0, angle2: 0, axis: null, reach: l1 + l2 };
    var d = dist;
    if (d > l1 + l2 - 1e-4) { d = l1 + l2 - 1e-4; res.ok = false; }
    if (d < Math.abs(l1 - l2) + 1e-4) { d = Math.abs(l1 - l2) + 1e-4; res.ok = false; }
    // 余弦定理
    var a1 = Math.acos(U.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    var a2 = Math.acos(U.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
    res.angle1 = a1;
    res.angle2 = Math.PI - a2;         // 第二段相对第一段的弯折量
    // 旋转轴：目标方向 × pole（保证膝朝向 pole 一侧）
    var axis = new THREE.Vector3().crossVectors(res.dir, pole);
    if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1); else axis.normalize();
    res.axis = axis;
    return res;
  };

  PB.U = U;
})();
