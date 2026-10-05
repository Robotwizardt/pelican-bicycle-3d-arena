/**
 * scene/cape.js —— 海岬环形邮路 + 崖壁地形 + 木栈桥码头
 *
 * 设计要点：
 *  1) 赛道不是随手点的曲线，而是由极坐标函数（半径 key + 高程 key，循环 Catmull-Rom 插值）
 *     生成的**星形闭合环**，因此「离质心方向」永远是可靠的外法线，海在环外、陆地（岬角本体）在环内。
 *  2) 地形是一条**沿赛道挤出的带状网格**：外侧（朝海）从路缘直接垂落到海面以下形成崖壁，
 *     内侧（朝陆）按剖面抬升为山坡，并按方位角加权 —— 只有南侧是大陆，其余三面临海，
 *     这样从任何角度望出去都还是「海岬」而不是「环山的湖」。
 *  3) 灯塔 / 栈桥 / 观景台这些地标通过「地形压平」机制获得平台，再单独放建筑。
 *
 * 所有长度单位 = 米。道路标称宽 6.2m，两侧各 0.55m 路肩。
 */
import * as THREE from 'three';
import { clamp, clamp01, lerp, makeFbm2D, makeRng, TAU, smoothstep } from '../util.js';

export const ROAD_HALF_WIDTH = 3.1;
export const ROAD_SHOULDER = 0.55;

/* ------------------------------------------------------------------ 循环插值 */

/** 一维循环 Catmull-Rom：keys = [{t, v}]，t 递增，最后一个与第一个相接。 */
function cyclicKeys(keys) {
  const n = keys.length;
  return function evalAt(t) {
    t = ((t % 1) + 1) % 1;
    let i = 0;
    for (let k = 0; k < n; k++) {
      if (keys[k].t <= t) i = k;
    }
    const t0 = keys[i].t;
    let t1 = keys[(i + 1) % n].t;
    if (t1 <= t0) t1 += 1;
    if (t < t0) t -= 1;
    const span = t1 - t0;
    const u = span > 1e-6 ? (t - t0) / span : 0;
    const p0 = keys[(i - 1 + n) % n].v;
    const p1 = keys[i].v;
    const p2 = keys[(i + 1) % n].v;
    const p3 = keys[(i + 2) % n].v;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      0.5 *
      ((2 * p1) +
        (-p0 + p2) * u +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
    );
  };
}

/* ------------------------------------------------------------------ 地标表 */

// θ 归一化到 0..1。t=0 在东偏北，顺时针一圈。
const STATIONS = {
  pier: 0.72,        // 木栈桥码头（西侧、最低处）
  postOffice: 0.715, // 邮政车库，紧邻码头广场
  lighthouse: 0.055, // 灯塔院子（东侧高点）
  lookout: 0.34,     // 观景平台
  summit: 0.42,      // 路段最高点（爬坡顶点）
  bench1: 0.20,
  bench2: 0.52,
  bench3: 0.83,
  gull1: 0.26,
  gull2: 0.62,
};

// 半径：海岬轮廓（外凸/内凹）
const R_KEYS = cyclicKeys([
  { t: 0.0, v: 43 }, { t: 0.08, v: 46 }, { t: 0.17, v: 44 }, { t: 0.26, v: 40 },
  { t: 0.34, v: 37 }, { t: 0.42, v: 39 }, { t: 0.5, v: 42 }, { t: 0.58, v: 41 },
  { t: 0.66, v: 38 }, { t: 0.72, v: 36 }, { t: 0.8, v: 39 }, { t: 0.88, v: 42 },
  { t: 0.94, v: 43 },
]);

// 高程：西侧码头最低（1.4m），东侧灯塔高（8.2m），整体起伏提供 8% 左右的坡度
const E_KEYS = cyclicKeys([
  { t: 0.0, v: 7.6 }, { t: 0.08, v: 8.2 }, { t: 0.17, v: 7.4 }, { t: 0.26, v: 6.2 },
  { t: 0.34, v: 5.4 }, { t: 0.42, v: 6.8 }, { t: 0.5, v: 6.0 }, { t: 0.58, v: 4.6 },
  { t: 0.66, v: 3.0 }, { t: 0.72, v: 1.5 }, { t: 0.8, v: 1.4 }, { t: 0.88, v: 2.6 },
  { t: 0.94, v: 5.0 },
]);

/* ------------------------------------------------------------------ 赛道 */

/**
 * 环向 t∈[0,1) → 中心线采样点。t 与 θ 一一对应（θ = t*TAU），
 * 但弧长 s 并不与 t 成正比（半径在变），所以后面要用重采样把 s 均匀化。
 */
function rawPoint(t) {
  const theta = t * TAU;
  const r = R_KEYS(t) + 1.1 * Math.sin(7 * theta + 0.9) + 0.7 * Math.sin(11 * theta + 2.2);
  const y = E_KEYS(t) + 0.45 * Math.sin(7 * theta + 1.7) + 0.22 * Math.sin(13 * theta);
  return new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
}

/** 把闭合折线重采样成等弧长采样表，并附带外法线/朝向/坡度/曲率。 */
function buildTrack(rawPts, count = 1400) {
  // 1) 加密原始折线并累计弧长
  const dense = [];
  const DENSE = count * 4;
  for (let i = 0; i < DENSE; i++) {
    const t = i / DENSE;
    dense.push({ t, p: rawPoint(t) });
  }
  const cum = [0];
  for (let i = 1; i <= DENSE; i++) {
    const a = dense[i - 1].p;
    const b = dense[i % DENSE].p;
    cum.push(cum[i - 1] + a.distanceTo(b));
  }
  const length = cum[DENSE];

  // 2) 等弧长采样
  const samples = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / count) * length;
    while (seg < DENSE - 1 && cum[seg + 1] < s) seg++;
    const s0 = cum[seg];
    const s1 = cum[seg + 1];
    const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const a = dense[seg];
    const b = dense[seg + 1];
    const p = a.p.clone().lerp(b.p, f);
    const tangent = b.p.clone().sub(a.p);
    if (tangent.lengthSq() < 1e-9) tangent.set(0, 0, 1);
    tangent.normalize();
    samples.push({ t: lerp(a.t, b.t > a.t ? b.t : b.t + 1, f), s, pos: p, tangent });
  }

  // 3) 外法线（星形环 → 用离质心方向）、朝向、曲率
  const centroid = new THREE.Vector3();
  for (const sm of samples) centroid.add(sm.pos);
  centroid.multiplyScalar(1 / samples.length);
  for (const sm of samples) {
    const outward = new THREE.Vector3(sm.pos.x - centroid.x, 0, sm.pos.z - centroid.z);
    if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
    outward.normalize();
    sm.outward = outward;
    sm.inward = outward.clone().negate();
    sm.heading = Math.atan2(sm.tangent.x, sm.tangent.z);
  }
  // 曲率：朝向差分
  const win = 6;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[(i - win + samples.length) % samples.length];
    const b = samples[(i + win) % samples.length];
    let dh = b.heading - a.heading;
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    samples[i].curvature = dh / ((2 * win * length) / samples.length);
  }

  const table = { samples, length, centroid, count };

  /** 弧长 s（米）处的赛道状态；s 可超出 [0,length) 自动绕圈。 */
  function at(s) {
    const ss = ((s % length) + length) % length;
    const idx = (ss / length) * count;
    const i0 = Math.floor(idx) % count;
    const i1 = (i0 + 1) % count;
    const f = idx - Math.floor(idx);
    const a = samples[i0];
    const b = samples[i1];
    const pos = a.pos.clone().lerp(b.pos, f);
    const tangent = a.tangent.clone().lerp(b.tangent, f).normalize();
    const outward = a.outward.clone().lerp(b.outward, f).normalize();
    return {
      s: ss,
      pos,
      tangent,
      outward,
      inward: outward.clone().negate(),
      heading: Math.atan2(tangent.x, tangent.z),
      grade: Math.asin(clamp(tangent.y, -1, 1)),
      curvature: lerp(a.curvature, b.curvature, f),
      theta: ss / length, // 参数化坐标：地标用
    };
  }

  /** 反查：世界坐标最近处的弧长（地标定位用） */
  function sNearest(p) {
    let best = Infinity;
    let bs = 0;
    for (const sm of samples) {
      const dx = sm.pos.x - p.x;
      const dz = sm.pos.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bs = sm.s;
      }
    }
    return bs;
  }

  return { ...table, at, sNearest };
}

/* ------------------------------------------------------------------ 地形剖面 */

// [横向偏移 u（+ 朝海 / − 朝陆）, 相对路面高差]
const PROFILE = [
  [3.7, -0.02],   // 崖顶唇口
  [4.3, -1.1],
  [5.1, -2.8],
  [6.4, -5.2],
  [8.6, -8.2],
  [12.0, -11.5],
  [18.0, -15.0],
  [30.0, -19.0],
  [-1.2, -0.28],  // 路肩内侧
  [-3.6, -0.10],  // 路边平地（与路面齐平）
  [-5.4, 0.35],
  [-8.5, 1.5],
  [-13, 3.4],
  [-20, 6.4],
  [-30, 7.0],
  // 内陆方向：不能堆太高太远。远处一旦堆到 20m+ 就会变成一堵横穿视野的白墙，
  // 把整个海岬压成“悬在白板上的公路”。所以只留一道 ~10m 的背脊，远处直接收掉。
  [-46, 8.5],
  [-70, 10.0],
  [-110, 8.0],
  [-190, 4.0],
  [-320, 1.0],
  [-700, -6.0],
  [-1400, -26.0], // 远处没入海中（早已被雾吃掉）
];

const LAND_WEIGHTS = [
  // t, 权重（1 = 大陆方向，越小越临海）
  { t: 0.0, v: 0.55 }, { t: 0.25, v: 0.34 }, { t: 0.5, v: 0.22 },
  { t: 0.62, v: 0.20 }, { t: 0.72, v: 0.18 }, { t: 0.82, v: 0.28 },
  { t: 0.92, v: 0.5 },
];

/** 大陆方向权重：南侧（t≈0.55~0.7）为 1，其它方向趋于临海。 */
function landWeight(t) {
  const n = LAND_WEIGHTS.length;
  t = ((t % 1) + 1) % 1;
  let i = 0;
  for (let k = 0; k < n; k++) if (LAND_WEIGHTS[k].t <= t) i = k;
  const a = LAND_WEIGHTS[i];
  const b = LAND_WEIGHTS[(i + 1) % n];
  let t1 = b.t > a.t ? b.t : b.t + 1;
  if (t < a.t) t += 1;
  const span = t1 - a.t;
  const u = span > 1e-6 ? clamp01((t - a.t) / span) : 0;
  return lerp(a.v, b.v, u * u * (3 - 2 * u));
}

/** 地标压平区：让某个站位附近的内侧地形变成平台。 */
function flattenAt(t, stationT, halfArc, innerTo, dy, falloff = 18) {
  let dt = Math.abs(t - stationT);
  dt = Math.min(dt, 1 - dt); // 环形距离
  const along = clamp01(1 - dt / halfArc);
  if (along <= 0) return null;
  return { along: along * along * (3 - 2 * along), innerTo, dy, falloff };
}

/* ------------------------------------------------------------------ 主体 */

/**
 * @param {THREE.Scene} scene
 * @param {{rock:THREE.Texture, asphalt:THREE.Texture, canvas:{map:THREE.Texture,bumpMap:THREE.Texture}}} textures
 */
export function createCape(scene, textures) {
  const group = new THREE.Group();
  group.name = 'cape';
  const rng = makeRng(31337);
  const fbm = makeFbm2D(808, 5, 2.11, 0.5);

  const track = buildTrack(rawPoint, 1400);

  /* ---------------- 地形带 ---------------- */
  const terrain = buildTerrain(track, fbm, textures);
  group.add(terrain.mesh);

  /* ---------------- 路面 ---------------- */
  const road = buildRoad(track, textures);
  group.add(road.group);

  /* ---------------- 护栏（临海一侧） ---------------- */
  const rails = buildRailings(track);
  group.add(rails.group);

  /* ---------------- 栈桥码头 ---------------- */
  const pier = buildPier(track, textures, STATIONS.pier);
  group.add(pier.group);

  /* ---------------- 远景：海蚀拱门 / 海蚀柱 / 礁石 ---------------- */
  const landmarks = buildSeaLandmarks(textures, rng);
  group.add(landmarks.group);

  /* ---------------- 路边道具 ---------------- */
  const props = buildProps(track, textures, pier);
  group.add(props.group);

  scene.add(group);

  return {
    group,
    track,
    length: track.length,
    at: track.at,
    terrain,
    road,
    rails,
    pier,
    props,
    stations: STATIONS,
  };
}

/* ------------------------------------------------------------------ 地形 */

function buildTerrain(track, fbm, textures) {
  // 必须用全部采样点：之前截断到 900（实际 1400），结果最后 36% 的环岛没有路面，
  // 鹈鹕骑到那一段就像悬在裸地形上。
  const RINGS = track.count;
  const N = PROFILE.length;
  const positions = new Float32Array(RINGS * N * 3);
  const uvs = new Float32Array(RINGS * N * 2);
  const indices = [];

  const flats = [
    // 码头广场：内侧压平
    flattenAt(0, STATIONS.pier, 0.055, 13, -0.02),
    // 灯塔院子
    flattenAt(0, STATIONS.lighthouse, 0.035, 17, 0.55),
    // 观景平台
    flattenAt(0, STATIONS.lookout, 0.022, 12, 0.30),
  ];

  const pos = new THREE.Vector3();
  for (let r = 0; r < RINGS; r++) {
    const sm = track.samples[r];
    const t = sm.s / track.length;
    const lw = landWeight(t);
    for (let k = 0; k < N; k++) {
      const [u, dy0] = PROFILE[k];
      let dy = dy0;
      const inland = u < 0;
      if (inland) {
        // 越往内陆抬得越高，但按方位角加权 → 只有一侧是大陆
        const climb = clamp01(-u / 12);
        const w = lerp(0.12, 1.0, lw) * climb + (1 - climb) * 0.0;
        dy = dy0 * w;
        // 噪声起伏（近处保持干净，远处放开）
        const far = clamp01((-u - 6) / 30);
        const n = fbm(sm.pos.x * 0.014 + 40, sm.pos.z * 0.014 - 25) - 0.5;
        dy += n * 26 * far * lerp(0.25, 1.0, lw);
        // 远处再抬高一点形成丘陵
        if (-u > 40) dy += (-u - 40) * 0.045 * lw;
      } else {
        const n = fbm(sm.pos.x * 0.05 + 7, sm.pos.z * 0.05 + 19) - 0.5;
        dy += n * 0.9 * clamp01((u - 3.7) / 2.5);
      }
      // 地标压平
      for (const fl of flats) {
        if (!fl) continue;
        const inner = -u;
        if (inner < -2 || inner > fl.innerTo + fl.falloff) continue;
        const alongW = fl.along * smoothstep(fl.innerTo + fl.falloff, fl.innerTo, inner) * smoothstep(-2.2, 1.2, inner);
        if (alongW > 0.001) dy = lerp(dy, fl.dy - 0.12, alongW);
      }
      pos.copy(sm.pos).addScaledVector(sm.outward, u);
      pos.y += dy;
      const o = (r * N + k) * 3;
      positions[o] = pos.x;
      positions[o + 1] = pos.y;
      positions[o + 2] = pos.z;
      const o2 = (r * N + k) * 2;
      // UV 用世界尺度而不是剖面索引：剖面跨度从崖唇到内陆上千米，
      // 若直接用 u 会把贴图拉成一片均匀色，地面看起来就像一块白板。
      uvs[o2] = pos.x * 0.06;
      uvs[o2 + 1] = pos.z * 0.06;
    }
  }
  for (let r = 0; r < RINGS; r++) {
    const r2 = (r + 1) % RINGS;
    for (let k = 0; k < N - 1; k++) {
      const a = r * N + k;
      const b = r2 * N + k;
      // 绕序必须是 (a, b, a+1)：PROFILE 是「海侧 → 内陆」递减的，
      // 反着绕会让整片地形法线朝下（法线 Y ≈ -1），地面变成悬在路面上方的白板。
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: textures.rock,
    roughness: 0.95,
    metalness: 0,
    // 暖砂岩：把地面从死白压回土色，与冷色的海形成对比。
    // rock 贴图本身已经是中灰，所以 tint 不能再深，否则叠出来是近黑。
    color: new THREE.Color('#a99e8b'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, geometry: geo, material: mat };
}

/* ------------------------------------------------------------------ 路面 */

function buildRoad(track, textures) {
  const group = new THREE.Group();
  group.name = 'road';
  const RINGS = track.count; // 同上：不能截断，否则环岛尾段没有路面
  const lanes = [
    { u: ROAD_HALF_WIDTH + ROAD_SHOULDER, y: 0.015 },
    { u: ROAD_HALF_WIDTH + 0.16, y: 0.075 },
    { u: ROAD_HALF_WIDTH, y: 0.10 },
    { u: -ROAD_HALF_WIDTH, y: 0.10 },
    { u: -ROAD_HALF_WIDTH - 0.16, y: 0.075 },
    { u: -ROAD_HALF_WIDTH - ROAD_SHOULDER, y: 0.015 },
  ];
  const N = lanes.length;
  const positions = new Float32Array(RINGS * N * 3);
  const uvs = new Float32Array(RINGS * N * 2);
  const indices = [];
  const p = new THREE.Vector3();
  for (let r = 0; r < RINGS; r++) {
    const sm = track.samples[r];
    // 弯道倾斜（banking）：曲率越大越倾，最多约 7°
    const bank = clamp(-sm.curvature * 42, -0.12, 0.12);
    for (let k = 0; k < N; k++) {
      const lane = lanes[k];
      p.copy(sm.pos).addScaledVector(sm.outward, lane.u);
      p.y += lane.y + bank * lane.u * -1.0;
      const o = (r * N + k) * 3;
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
      const o2 = (r * N + k) * 2;
      uvs[o2] = k / (N - 1);
      uvs[o2 + 1] = sm.s * 0.16;
    }
  }
  for (let r = 0; r < RINGS; r++) {
    const r2 = (r + 1) % RINGS;
    for (let k = 0; k < N - 1; k++) {
      const a = r * N + k;
      const b = r2 * N + k;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const asphalt = textures.asphalt.map.clone();
  asphalt.needsUpdate = true;
  asphalt.repeat.set(1.6, 1);
  // bump 用独立生成的平滑颗粒图，repeat 与 map 对齐
  const asphaltBump = textures.asphalt.bump.clone();
  asphaltBump.needsUpdate = true;
  asphaltBump.repeat.set(1.6, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: asphalt,
    bumpMap: asphaltBump,
    bumpScale: 0.22,
    // 路面：深色湿沥青。海岬常年有雾，路面反光是场景里最亮的地面元素
    roughness: 0.46,
    metalness: 0,
    // 沥青本色（贴图底色已归一到中灰，这里给实际的沥青色）。
    // 湿沥青：深但不黑，能看见骨料和拼缝。
    color: new THREE.Color('#8d949c'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'roadMesh';
  group.add(mesh);

  // 中线：程序生成的虚线贴图
  const lineTex = makeDashTexture();
  lineTex.wrapT = THREE.RepeatWrapping;
  lineTex.repeat.set(1, 1);
  const lineGeo = new THREE.BufferGeometry();
  const lp = [];
  const luv = [];
  const R2 = track.count; // 同上：路标线/边线要铺满整圈
  const LN = 2;
  for (let r = 0; r < R2; r++) {
    const sm = track.samples[r];
    for (let k = 0; k < LN; k++) {
      const u = k === 0 ? 0.09 : -0.09;
      p.copy(sm.pos).addScaledVector(sm.outward, u);
      p.y += 0.115;
      lp.push(p.x, p.y, p.z);
      luv.push(k, sm.s / 5.0);
    }
  }
  const li = [];
  for (let r = 0; r < R2; r++) {
    const r2 = (r + 1) % R2;
    const a = r * LN;
    const b = r2 * LN;
    li.push(a, b, a + 1, a + 1, b, b + 1);
  }
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lineGeo.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  lineGeo.setIndex(li);
  lineGeo.computeVertexNormals();
  const lineMat = new THREE.MeshBasicMaterial({
    map: lineTex,
    transparent: true,
    depthWrite: false,
    color: new THREE.Color('#f2e6c8'),
    opacity: 0.75,
  });
  const line = new THREE.Mesh(lineGeo, lineMat);
  line.renderOrder = 1;
  group.add(line);

  // 白色路缘线（临海侧）
  const kerbTex = makeKerbTexture();
  kerbTex.wrapT = THREE.RepeatWrapping;
  const kp = [];
  const kuv = [];
  const KN = 2;
  for (let r = 0; r < R2; r++) {
    const sm = track.samples[r];
    for (let k = 0; k < KN; k++) {
      const u = k === 0 ? ROAD_HALF_WIDTH - 0.1 : ROAD_HALF_WIDTH - 0.42;
      p.copy(sm.pos).addScaledVector(sm.outward, u);
      p.y += 0.112;
      kp.push(p.x, p.y, p.z);
      kuv.push(k, sm.s / 5.0);
    }
  }
  const ki = [];
  for (let r = 0; r < R2; r++) {
    const r2 = (r + 1) % R2;
    const a = r * KN;
    const b = r2 * KN;
    ki.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const kerbGeo = new THREE.BufferGeometry();
  kerbGeo.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
  kerbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(kuv, 2));
  kerbGeo.setIndex(ki);
  kerbGeo.computeVertexNormals();
  const kerb = new THREE.Mesh(kerbGeo, new THREE.MeshStandardMaterial({
    map: kerbTex,
    roughness: 0.8,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    color: '#e8e2d2',
  }));
  kerb.renderOrder = 1;
  group.add(kerb);

  return { group, mesh, line, kerb, material: mat };
}

function makeDashTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 8, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 8, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeKerbTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fillRect(0, 10, 8, 44);
  ctx.clearRect(0, 0, 8, 10);
  ctx.clearRect(0, 54, 8, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ 护栏 */

/** 临海一侧：崖顶立柱 + 两道横杆。柱用 InstancedMesh，杆用沿路挤出的管。 */
function buildRailings(track) {
  const group = new THREE.Group();
  group.name = 'railings';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#eef2f6'),
    roughness: 0.42,
    metalness: 0.35,
  });
  const spacing = 3.2;
  const count = Math.floor(track.length / spacing);
  const postGeo = new THREE.CylinderGeometry(0.055, 0.075, 1.0, 7);
  postGeo.translate(0, 0.5, 0);
  const posts = new THREE.InstancedMesh(postGeo, mat, count);
  posts.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const u = ROAD_HALF_WIDTH + ROAD_SHOULDER + 0.15;
  const railOffset = u + 0.15;
  for (let i = 0; i < count; i++) {
    const sm = track.at(i * spacing);
    const p = sm.pos.clone().addScaledVector(sm.outward, u);
    p.y += 0.02;
    m.compose(p, q, one);
    posts.setMatrixAt(i, m);
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  for (const h of [1.02, 0.62]) {
    const pts = [];
    const step = 2.0;
    const n = Math.floor(track.length / step);
    for (let i = 0; i <= n; i++) {
      const sm = track.at(i * step);
      const p = sm.pos.clone().addScaledVector(sm.outward, railOffset);
      p.y += h;
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    const geo = new THREE.TubeGeometry(curve, n, h > 0.9 ? 0.045 : 0.032, 5, true);
    const rail = new THREE.Mesh(geo, mat);
    rail.castShadow = true;
    group.add(rail);
  }
  return { group, posts };
}

/* ------------------------------------------------------------------ 栈桥码头 */

/** 从崖顶伸进海里的木栈桥：桥面板 + 桩 + 系缆桩 + 泊位 + 摇橹小船。 */
function buildPier(track, textures, stationT) {
  const group = new THREE.Group();
  group.name = 'pier';
  const s = stationT * track.length;
  const sm = track.at(s);
  const rng = makeRng(4242);

  const woodMat = new THREE.MeshStandardMaterial({
    map: textures.canvas.map,
    bumpMap: textures.canvas.bumpMap,
    bumpScale: 0.5,
    color: new THREE.Color('#a3763f'),
    roughness: 0.88,
    metalness: 0,
  });
  const darkWood = woodMat.clone();
  darkWood.color = new THREE.Color('#6b4d2c');
  const metalMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#39434e'),
    roughness: 0.4,
    metalness: 0.75,
  });

  const root = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.outward, 2.0);
  root.y = sm.pos.y + 0.1;
  const dir = sm.outward.clone();
  const LEN = 46;
  const WIDTH = 3.2;
  const deckDrop = 0.55; // 桥面比路面低，向海缓缓下降

  // 桥面板（逐段摆放，带缝隙与轻微下垂）
  const plankCount = Math.floor(LEN / 0.62);
  const plankGeo = new THREE.BoxGeometry(WIDTH, 0.11, 0.55);
  const planks = new THREE.InstancedMesh(plankGeo, woodMat, plankCount);
  planks.receiveShadow = true;
  planks.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    dir
  );
  const one = new THREE.Vector3(1, 1, 1);
  const pilingPositions = [];
  for (let i = 0; i < plankCount; i++) {
    const d = 1.0 + i * 0.62;
    const p = root.clone().addScaledVector(dir, d);
    p.y = root.y - deckDrop * (d / LEN) - 0.02;
    m.compose(p, q, one);
    planks.setMatrixAt(i, m);
    if (i % 6 === 0 && d > 4 && d < LEN - 4) pilingPositions.push(p.clone().setY(p.y - 5.2));
  }
  planks.instanceMatrix.needsUpdate = true;
  group.add(planks);

  // 纵梁
  for (const side of [-1, 1]) {
    const beamPts = [];
    for (let i = 0; i <= 12; i++) {
      const d = (i / 12) * LEN;
      const p = root.clone().addScaledVector(dir, d);
      p.y = root.y - deckDrop * (d / LEN) - 0.13;
      p.addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), side * (WIDTH / 2 - 0.2));
      beamPts.push(p);
    }
    const beam = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(beamPts, false, 'centripetal', 0.5), 24, 0.12, 5, false),
      darkWood
    );
    beam.castShadow = true;
    group.add(beam);
  }

  // 桩
  const pileGeo = new THREE.CylinderGeometry(0.19, 0.24, 6.6, 9);
  pileGeo.translate(0, -3.3, 0);
  const piles = new THREE.InstancedMesh(pileGeo, darkWood, pilingPositions.length * 2);
  let pi = 0;
  for (const base of pilingPositions) {
    for (const side of [-1, 1]) {
      const p = base.clone().addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), side * (WIDTH / 2 - 0.25));
      p.y = base.y + 5.2 - deckDrop * 0.0;
      m.compose(new THREE.Vector3(p.x, root.y - deckDrop * (base.distanceTo(root) / LEN) - 0.3, p.z), q, one);
      piles.setMatrixAt(pi++, m);
    }
  }
  piles.count = pi;
  piles.instanceMatrix.needsUpdate = true;
  piles.castShadow = true;
  group.add(piles);

  // 系缆桩 + 缆绳
  const bollardGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.62, 10);
  bollardGeo.translate(0, 0.31, 0);
  const bollards = new THREE.InstancedMesh(bollardGeo, metalMat, 5);
  const bollardSpots = [];
  for (let i = 0; i < 5; i++) {
    const d = 6 + i * 9;
    const p = root.clone().addScaledVector(dir, d);
    p.y = root.y - deckDrop * (d / LEN) + 0.05;
    p.addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), (i % 2 ? 1 : -1) * (WIDTH / 2 - 0.35));
    m.compose(p, q, one);
    bollards.setMatrixAt(i, m);
    bollardSpots.push(p);
  }
  bollards.instanceMatrix.needsUpdate = true;
  bollards.castShadow = true;
  group.add(bollards);

  // 端头小平台 + 航标浮筒
  const endDeck = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.14, 16), woodMat);
  const endP = root.clone().addScaledVector(dir, LEN);
  endP.y = root.y - deckDrop - 0.02;
  endDeck.position.copy(endP);
  endDeck.receiveShadow = true;
  endDeck.castShadow = true;
  group.add(endDeck);

  const buoy = new THREE.Group();
  const buoyBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 14, 12),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#e34a33'), roughness: 0.55 })
  );
  buoyBody.scale.y = 0.8;
  const buoyTop = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.8, 10),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#f5f0e2'), roughness: 0.6 })
  );
  buoyTop.position.y = 0.7;
  buoy.add(buoyBody, buoyTop);
  const buoyP = root.clone().addScaledVector(dir, LEN + 9);
  buoy.position.copy(buoyP);
  buoy.position.y = 0.15;
  group.add(buoy);

  // 两条泊位小船
  const boats = [];
  for (let i = 0; i < 2; i++) {
    const boat = buildDinghy(textures, rng);
    const d = 14 + i * 13;
    const p = root.clone().addScaledVector(dir, d);
    p.addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), (i ? 1 : -1) * (WIDTH / 2 + 1.5));
    p.y = -0.16;
    boat.group.position.copy(p);
    boat.group.rotation.y = Math.atan2(dir.x, dir.z) + (i ? 1 : -1) * 0.12;
    group.add(boat.group);
    boats.push(boat);
  }

  return {
    group,
    root: root.clone(),
    dir: dir.clone(),
    length: LEN,
    deckY: root.y - deckDrop,
    bollardSpots,
    pilingPositions,
    boats,
    buoy,
    stationT,
  };
}

/** 顺手搓一条小木船（外壳用 Lathe 的一半 + 内部座板 + 桨）。 */
function buildDinghy(textures, rng) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({
    map: textures.canvas.map,
    color: new THREE.Color('#c9d3d8'),
    roughness: 0.7,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const hullProfile = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    hullProfile.push(new THREE.Vector2(0.02 + Math.sin(t * Math.PI) * 0.62, t * 0.62));
  }
  const hull = new THREE.Mesh(new THREE.LatheGeometry(hullProfile, 12), woodMat);
  hull.scale.set(1.0, 1.0, 2.5);
  hull.castShadow = true;
  group.add(hull);
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.07, 0.22),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a6a44'), roughness: 0.85 })
  );
  bench.position.y = 0.4;
  group.add(bench);
  const oar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1.9, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#a07a4c'), roughness: 0.8 })
  );
  oar.rotation.set(0.2, 0.4, Math.PI / 2 - 0.25);
  oar.position.set(0.1, 0.5, 0.2);
  group.add(oar);
  return { group };
}

/* ------------------------------------------------------------------ 远景地标 */

function buildSeaLandmarks(textures, rng) {
  const group = new THREE.Group();
  group.name = 'seaLandmarks';
  const rockMat = new THREE.MeshStandardMaterial({
    map: textures.rock,
    roughness: 0.96,
    color: new THREE.Color('#8b96a3'),
  });
  const rockMatFar = new THREE.MeshStandardMaterial({
    map: textures.rock,
    roughness: 0.98,
    color: new THREE.Color('#93a0ad'),
  });

  // 海蚀拱门：远景，位于东北方向
  const archGroup = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-1.0, 0);
  const SEG = 26;
  for (let i = 0; i <= SEG; i++) {
    const a = Math.PI * (i / SEG);
    const wobble = 1 + 0.06 * Math.sin(a * 7.0);
    shape.lineTo(-Math.cos(a) * wobble, Math.sin(a) * wobble * 1.05);
  }
  shape.lineTo(1.0, 0);
  shape.lineTo(1.0, -0.5);
  shape.lineTo(-1.0, -0.5);
  shape.closePath();
  const archGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 5.0,
    bevelEnabled: true,
    bevelThickness: 0.5,
    bevelSize: 0.5,
    bevelSegments: 2,
    curveSegments: SEG,
  });
  archGeo.computeVertexNormals();
  const arch = new THREE.Mesh(archGeo, rockMat);
  arch.rotation.y = Math.PI * 0.5;
  arch.position.set(150, 3.2, -60);
  arch.scale.set(13, 12, 1);
  archGroup.add(arch);
  group.add(archGroup);

  // 海蚀柱：远近错落，构成纵深
  const stacks = [
    { x: -96, z: -128, s: 1.0, seed: 71 },
    { x: -128, z: -96, s: 0.78, seed: 88 },
    { x: 210, z: -190, s: 1.7, seed: 99 },
    { x: 330, z: -330, s: 2.8, seed: 103 },
    { x: -300, z: 190, s: 2.0, seed: 111 },
    { x: 250, z: 210, s: 2.4, seed: 117 },
    { x: 60, z: 300, s: 1.5, seed: 123 },
  ];
  for (const s of stacks) {
    const m = new THREE.Mesh(makeStack(s.s, s.seed), s.s > 2 ? rockMatFar : rockMat);
    m.position.set(s.x, -1.6 * s.s, s.z);
    m.rotation.y = rng() * TAU;
    group.add(m);
  }

  // 近景礁石
  const boulderSpots = [
    { x: -62, z: 34, s: 3.0 },
    { x: -46, z: 52, s: 2.2 },
    { x: 58, z: 8, s: 2.6 },
    { x: 68, z: -26, s: 3.4 },
    { x: 12, z: -74, s: 2.4 },
    { x: -80, z: -14, s: 4.2 },
    { x: 96, z: 44, s: 3.6 },
    { x: -108, z: 18, s: 5.0 },
    { x: 30, z: 86, s: 2.0 },
  ];
  const boulderGeo = makeBoulder(9, 1);
  for (const b of boulderSpots) {
    const m = new THREE.Mesh(boulderGeo, rockMat);
    m.position.set(b.x, -1.1 * b.s * 0.5, b.z);
    m.scale.setScalar(b.s);
    m.rotation.set(rng() * 0.4, rng() * TAU, (rng() - 0.5) * 0.4);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group };
}

function makeStack(scale, seed) {
  const fbm = makeFbm2D(seed, 4, 2.07, 0.52);
  const geo = new THREE.CylinderGeometry(3.4 * scale, 5.2 * scale, 14 * scale, 20, 12, false);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const hN = clamp01(v.y / (14 * scale) + 0.5);
    const ang = Math.atan2(v.z, v.x);
    let r = 1 + (fbm(ang * 1.6 + hN * 3.2 + seed, hN * 6.0 + seed) - 0.5) * 0.42;
    r *= lerp(1.0, 0.72, Math.pow(hN, 0.8));
    v.x = Math.cos(ang) * r * Math.hypot(v.x, v.z);
    v.z = Math.sin(ang) * r * Math.hypot(v.x, v.z);
    v.y += (fbm(hN * 4 + seed, ang * 2) - 0.5) * 1.2 * scale;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function makeBoulder(seed, detail) {
  const fbm = makeFbm2D(seed, 3, 2.1, 0.5);
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 1.5 + seed, v.z * 1.5 + v.y);
    v.multiplyScalar(0.75 + n * 0.55);
    v.y *= 0.6;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ 路边道具 */

function buildProps(track, textures, pier) {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = makeRng(5150);

  const woodMat = new THREE.MeshStandardMaterial({
    map: textures.canvas.map,
    bumpMap: textures.canvas.bumpMap,
    bumpScale: 0.4,
    color: new THREE.Color('#a5753d'),
    roughness: 0.85,
    metalness: 0,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#333d48'),
    roughness: 0.42,
    metalness: 0.72,
  });
  const lampGlassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fff6e2'),
    emissive: new THREE.Color('#ffcf8f'),
    emissiveIntensity: 0,
    roughness: 0.25,
    metalness: 0.1,
  });

  /* --- 路灯（内侧，整点带灯头朝向路面）：用 InstancedMesh 保性能 */
  const spacing = 22;
  const lampCount = Math.max(4, Math.floor(track.length / spacing));
  const lampGroup = new THREE.Group();
  lampGroup.name = 'lamps';
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 4.3, 8);
  poleGeo.translate(0, 2.15, 0);
  const armGeo = new THREE.BoxGeometry(0.9, 0.09, 0.09);
  armGeo.translate(0.45, 0, 0);
  const headGeo = new THREE.CylinderGeometry(0.28, 0.15, 0.34, 10);
  const poles = new THREE.InstancedMesh(poleGeo, metalMat, lampCount);
  const arms = new THREE.InstancedMesh(armGeo, metalMat, lampCount);
  const heads = new THREE.InstancedMesh(headGeo, lampGlassMat, lampCount);
  poles.castShadow = true;
  const lampLights = [];
  const m4 = new THREE.Matrix4();
  const qt = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  const lampPositions = [];
  for (let i = 0; i < lampCount; i++) {
    const sm = track.at(i * spacing + 4);
    const p = sm.pos.clone().addScaledVector(sm.outward, -(ROAD_HALF_WIDTH + ROAD_SHOULDER + 0.75));
    p.y -= 0.1;
    // 灯头指向路面（-outward）
    const yaw = Math.atan2(-sm.outward.x, -sm.outward.z);
    qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m4.compose(p, qt, scl);
    poles.setMatrixAt(i, m4);
    arms.setMatrixAt(i, m4);
    const headP = p.clone().addScaledVector(sm.outward, -0.9);
    headP.y += 4.28;
    m4.compose(headP, qt, scl);
    heads.setMatrixAt(i, m4);
    lampPositions.push(headP.clone());
    const light = new THREE.PointLight('#ffc17a', 0, 22, 2.0);
    light.position.copy(headP);
    lampGroup.add(light);
    lampLights.push(light);
  }
  poles.instanceMatrix.needsUpdate = true;
  arms.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  lampGroup.add(poles, arms, heads);
  group.add(lampGroup);

  /* --- 木长椅 ×3（内侧，朝海） --- */
  for (const key of ['bench1', 'bench2', 'bench3']) {
    const sm = track.at(STATIONS[key] * track.length);
    const p = sm.pos.clone().addScaledVector(sm.outward, -(ROAD_HALF_WIDTH + 1.5));
    p.y -= 0.05;
    const bench = new THREE.Group();
    bench.position.copy(p);
    // 椅背在 -Z 侧，所以要让 -Z 指向外侧（海）：rotY = atan2(-out.x, -out.z)
    bench.rotation.y = Math.atan2(-sm.outward.x, -sm.outward.z);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.09, 0.5), woodMat);
    seat.position.y = 0.46;
    seat.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.42, 0.07), woodMat);
    back.position.set(0, 0.74, -0.22);
    back.rotation.x = -0.16;
    back.castShadow = true;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.46, 0.42), metalMat);
    legL.position.set(-0.84, 0.23, 0);
    const legR = legL.clone();
    legR.position.x = 0.84;
    bench.add(seat, back, legL, legR);
    group.add(bench);
  }

  /* --- 里程牌 + 指路牌 --- */
  for (let i = 1; i <= 7; i++) {
    const s = (track.length / 8) * i;
    const sm = track.at(s);
    const p = sm.pos.clone().addScaledVector(sm.outward, -(ROAD_HALF_WIDTH + ROAD_SHOULDER + 0.35));
    const post = new THREE.Group();
    post.position.copy(p);
    post.rotation.y = Math.atan2(-sm.outward.x, -sm.outward.z);
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.95, 0.09), metalMat);
    stick.position.y = 0.48;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.3, 0.035),
      new THREE.MeshStandardMaterial({
        map: makeSignTexture(`${(s).toFixed(0)} m`),
        roughness: 0.62,
        metalness: 0.08,
      })
    );
    plate.position.y = 1.02;
    post.add(stick, plate);
    group.add(post);
  }

  /* --- 草丛：InstancedMesh 交叉面片，跟着地形走 --- */
  const grass = buildGrass(track, rng);
  if (grass) group.add(grass);

  /* --- 停在路边的邮差自行车（装饰） --- */
  const leaning = buildLeanBike(track, textures, STATIONS.postOffice);
  if (leaning) group.add(leaning);

  return { group, lampLights, lampPositions, lampGlassMat };
}

/** 交叉面片草：沿内侧路肩与山坡散布，跟着地形剖面取高度。 */
function buildGrass(track, rng) {
  const bladeGeo = new THREE.BufferGeometry();
  const h = 1.0;
  bladeGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.12, 0, 0, 0.12, 0, 0, -0.05, h * 0.6, 0.06, 0.05, h * 0.6, 0.06, 0, h, 0.02],
      3
    )
  );
  bladeGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  bladeGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.3, 0.5, 0.7, 0.5, 0.5, 1], 2));
  bladeGeo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);

  const COUNT = 2600;
  const mesh = new THREE.InstancedMesh(
    bladeGeo,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#7d8f56'),
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    COUNT
  );
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let n = 0;
  let guard = 0;
  while (n < COUNT && guard < COUNT * 8) {
    guard++;
    const sm = track.at(rng() * track.length);
    // 只在内侧（陆地）坡上
    const off = -(ROAD_HALF_WIDTH + 4.5 + rng() * 26);
    p.copy(sm.pos).addScaledVector(sm.outward, off);
    const t = sm.s / track.length;
    const lw = landWeight(t);
    const inland = clamp01((-off - 6) / 24);
    const climb = lerp(0.12, 1.0, lw) * inland;
    // 用与地形相同的剖面近似高度
    const dy = terrainDyAt(off) * climb;
    p.y += dy - 0.05;
    if (p.y < 0.6) continue; // 太靠近水面不长草
    const s = 0.5 + rng() * 0.9;
    sc.set(s * (0.7 + rng() * 0.6), s * (0.7 + rng() * 0.8), s);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU);
    m4.compose(p, q, sc);
    mesh.setMatrixAt(n++, m4);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  return mesh;
}

/** 与 buildTerrain 使用同一套剖面的一维插值（给道具/草取地面高度）。 */
function terrainDyAt(u) {
  if (u >= 0) {
    // 崖面：直接线性插值 PROFILE 的崖侧
    for (let i = 0; i < 8; i++) {
      const a = PROFILE[i];
      const b = PROFILE[i + 1];
      if (u >= a[0] && u <= b[0]) return lerp(a[1], b[1], (u - a[0]) / (b[0] - a[0]));
    }
    return -19;
  }
  const pts = PROFILE.filter((p) => p[0] <= 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (u <= a[0] && u >= b[0]) return lerp(a[1], b[1], (u - a[0]) / (b[0] - a[0]));
  }
  return pts[pts.length - 1][1];
}

function makeSignTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 200;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0e4d40';
  ctx.fillRect(0, 0, 512, 200);
  ctx.strokeStyle = '#eaf3ec';
  ctx.lineWidth = 7;
  ctx.strokeRect(10, 10, 492, 180);
  ctx.fillStyle = '#f3f8f3';
  ctx.font = 'bold 74px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 104);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 一辆倚在栏杆上的邮差自行车（纯装饰）。 */
function buildLeanBike(track, textures, stationT) {
  const sm = track.at(stationT * track.length + 4);
  const p = sm.pos.clone().addScaledVector(sm.outward, -(ROAD_HALF_WIDTH + ROAD_SHOULDER + 0.55));
  const g = new THREE.Group();
  g.position.copy(p);
  const yaw = Math.atan2(sm.outward.x, sm.outward.z);
  g.rotation.y = yaw + 0.5;
  g.rotation.z = -0.16;

  const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d5f6b'), roughness: 0.35, metalness: 0.6 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22262b'), roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b9c2c8'), roughness: 0.3, metalness: 0.8 });

  const wheelGeo = new THREE.TorusGeometry(0.34, 0.035, 8, 22);
  const rear = new THREE.Mesh(wheelGeo, tyreMat);
  rear.position.set(0, 0.35, 0.52);
  const front = new THREE.Mesh(wheelGeo, tyreMat);
  front.position.set(0, 0.35, -0.52);
  g.add(rear, front);
  for (const w of [rear, front]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.012, 6, 20), rimMat);
    rim.position.copy(w.position);
    g.add(rim);
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 4), rimMat);
      spoke.position.copy(w.position);
      spoke.rotation.z = (i / 6) * Math.PI;
      g.add(spoke);
    }
  }
  const tube = (x1, y1, z1, x2, y2, z2) => {
    const a = new THREE.Vector3(x1, y1, z1);
    const b = new THREE.Vector3(x2, y2, z2);
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(0.022, 0.022, len, 6);
    const mesh = new THREE.Mesh(geo, frameMat);
    mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(mesh);
  };
  tube(0, 0.35, 0.52, 0, 0.78, -0.05);   // seat tube
  tube(0, 0.78, -0.05, 0, 0.36, 0.42);   // down tube
  tube(0, 0.78, -0.05, 0, 0.82, -0.46);  // top tube → head
  tube(0, 0.36, 0.42, 0, 0.78, -0.05);   // seat stay
  tube(0, 0.82, -0.46, 0, 0.35, -0.52);  // fork
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: '#3b2a20', roughness: 0.7 }));
  saddle.position.set(0, 0.82, -0.02);
  g.add(saddle);
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 6), rimMat);
  bars.rotation.z = Math.PI / 2;
  bars.position.set(0, 0.95, -0.5);
  g.add(bars);
  // 邮包
  const bag = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.24, 0.36),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#c4432f'), roughness: 0.8 })
  );
  bag.position.set(0.02, 0.95, 0.2);
  bag.rotation.z = 0.06;
  g.add(bag);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

export { buildTrack };