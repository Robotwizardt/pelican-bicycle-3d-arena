/**
 * hud.js — HUD：绑定 index.html 中的静态面板（不注入 DOM）
 *   左：2D 画布速度表 + 踏频/里程/体力
 *   右：时刻/天光/里程/均速/气温/风 + 速度曲线（背景为真实地形横剖）
 *   顶：品牌 + 实时渲染统计
 *   底：涂装 / 机位 / 时间轴 / 画质 / 动作按钮
 *   另有：toast、加载层、帮助层、触屏摇杆、录屏、分享
 */
import { clamp } from '../lib/util.js';

const PERIODS = [[5, '拂晓'], [7, '日出'], [11, '上午'], [13, '正午'], [16, '午后'], [18, '日落'], [20, '黄昏'], [22, '夜里']];
const $ = (id) => document.getElementById(id);

/** 由小时数推出天光名称 */
export function dayPhase(hour) {
  let out = '深夜';
  for (const [h, name] of PERIODS) if (hour >= h) out = name;
  return out;
}
/** 气温模型：太阳高度驱动（纯展示用的合理近似） */
export function tempAt(hour) {
  const s = Math.sin(((hour - 6) / 12) * Math.PI);
  return 9.5 + Math.max(-0.35, s) * 15.5;
}
/** 风：多层正弦叠加的伪噪声 */
export function windAt(t) {
  return 2.1 + 2.4 * Math.abs(Math.sin(t * 0.037) * 0.7 + Math.sin(t * 0.113 + 1.7) * 0.3) + 1.1 * Math.sin(t * 0.7) * Math.sin(t * 0.19);
}
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
const clockText = (h) => `${pad2(h)}:${pad2((h % 1) * 60)}`;

export class Hud {
  constructor(handlers = {}) {
    this.h = handlers;
    this.el = {
      app: $('app'), boot: $('boot'), bootBar: $('boot-bar'), bootMsg: $('boot-msg'),
      topbar: $('topbar'), strip: $('stats-strip'),
      left: $('hud-left'), right: $('hud-right'), controls: $('controls'), touch: $('touch'),
      speedo: $('speedo'), profile: $('profile'), sparkLabel: document.querySelector('.spark em'),
      clock: $('v-clock'), phase: $('v-phase'), dist: $('v-dist'), climb: $('v-climb'), temp: $('v-temp'), wind: $('v-wind'),
      cad: $('v-cad'), gear: $('v-gear'), pow: $('v-pow'),
      toast: $('toast'), help: $('help'), cams: $('cams'), livery: $('livery'), quality: $('quality'),
      tod: $('tod'), todLabel: $('v-tod'), stick: $('stick'),
    };
    this._toastT = 0;
    this._uiVisible = true;
    this._hist = new Float32Array(220);
    this._histN = 0;
    this._speedoAcc = 0;
    this._lastKmh = -1;
    this._terrain = null;
    this._ctx = this.el.speedo?.getContext('2d') || null;
    this._pctx = this.el.profile?.getContext('2d') || null;
    this._dpr = Math.min(devicePixelRatio || 1, 2);
    for (const [c, ctx] of [[this.el.speedo, this._ctx], [this.el.profile, this._pctx]]) {
      if (!c || !ctx) continue;
      const w = c.width, hgt = c.height;
      c.width = w * this._dpr; c.height = hgt * this._dpr;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      c._w = w; c._h = hgt;
    }
    this._wireStatic();
    if (this.el.sparkLabel) this.el.sparkLabel.textContent = '地形剖面 · 速度';
  }

  /* ---------------------------------------------------------------- 静态接线 */
  _wireStatic() {
    const E = this.el;
    for (const b of document.querySelectorAll('[data-action]')) {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'help') this.showHelp(this.el.help.classList.contains('hidden'));
        else if (a === 'fullscreen') this._fullscreen();
        else if (a && this.h[a]) this.h[a]();
      });
    }
    E.tod?.addEventListener('input', () => {
      const hour = (+E.tod.value) / 60;
      this.setTime(hour);
      this.h.time?.(hour, true);
    });
    // 触屏摇杆
    const stick = E.stick;
    if (stick) {
      let active = false;
      const radius = 46;
      const move = (e) => {
        if (!active) return;
        const r = stick.getBoundingClientRect();
        const t = e.touches ? e.touches[0] : e;
        let dx = clamp((t.clientX - (r.left + r.width / 2)) / radius, -1, 1);
        let dy = clamp((t.clientY - (r.top + r.height / 2)) / radius, -1, 1);
        stick.firstElementChild.style.transform = `translate(${dx * radius * 0.62}px,${dy * radius * 0.62}px)`;
        if (this._input) {
          this._input.virtual.steer = dx;
          this._input.virtual.throttle = clamp(-dy, 0, 1);
          this._input.virtual.brake = clamp(dy, 0, 1) * 0.8;
          this._input.virtual.active = true;
        }
      };
      const end = () => {
        active = false;
        stick.firstElementChild.style.transform = '';
        if (this._input) {
          this._input.virtual.steer = 0; this._input.virtual.throttle = 0;
          this._input.virtual.brake = 0; this._input.virtual.active = false;
        }
      };
      stick.addEventListener('pointerdown', (e) => { active = true; stick.setPointerCapture?.(e.pointerId); move(e); });
      stick.addEventListener('pointermove', move);
      stick.addEventListener('pointerup', end);
      stick.addEventListener('pointercancel', end);
    }
    for (const b of document.querySelectorAll('[data-touch]')) {
      const k = b.dataset.touch;
      const on = (v) => {
        if (!this._input) return;
        const V = this._input.virtual;
        if (k === 'pedal') V.throttle = v ? 1 : 0;
        if (k === 'brake') V.brake = v ? 1 : 0;
        if (k === 'hop' && v) this.h.hop?.();
        if (k === 'ring' && v) this.h.ring?.();
        V.active = true;
      };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(true); });
      b.addEventListener('pointerup', () => on(false));
      b.addEventListener('pointerleave', () => on(false));
    }
  }

  /** 触屏模式下绑上输入源（摇杆写入 virtual 轴） */
  bindInput(input, isTouch) {
    this._input = input;
    if (isTouch) this.el.touch?.classList.remove('hidden');
  }

  /* -------------------------------------------------------------- 控件面板 */
  buildCams(list, current, onPick) {
    this._chips(this.el.cams, list.map((m) => ({ id: m.id, label: m.label })), current, (i) => onPick(i));
    this._camList = list;
  }
  buildLivery(list, current, onPick) {
    const box = this.el.livery;
    if (!box) return;
    box.innerHTML = '';
    list.forEach((l, i) => {
      const d = document.createElement('div');
      d.className = 'sw' + (i === current ? ' on' : '');
      d.title = l.name;
      d.style.background = `linear-gradient(140deg, ${css(l.frame)}, ${css(l.accent)})`;
      d.addEventListener('click', () => onPick(i));
      box.appendChild(d);
    });
  }
  buildQuality(list, current, onPick) {
    this._chips(this.el.quality, list, current, (i) => onPick(list[i].id ?? i));
  }
  _chips(box, list, current, onPick) {
    if (!box) return;
    box.innerHTML = '';
    list.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === current ? ' on' : '');
      b.textContent = it.label;
      b.addEventListener('click', () => onPick(i));
      box.appendChild(b);
    });
  }
  markChips(kind, index) {
    const box = kind === 'cam' ? this.el.cams : kind === 'quality' ? this.el.quality : this.el.livery;
    if (!box) return;
    [...box.children].forEach((c, i) => c.classList.toggle('on', i === index));
  }
  markAction(id, on) {
    const b = document.querySelector(`[data-action="${id}"]`);
    if (b) b.classList.toggle('on', !!on);
  }
  setSoundIcon(on) {
    const b = document.querySelector('[data-action="sound"]');
    if (b) { b.textContent = on ? '🔊' : '🔈'; b.classList.toggle('off', !on); }
  }

  /* ------------------------------------------------------------------ 状态 */
  setTime(hour) {
    const E = this.el;
    if (E.clock) E.clock.textContent = clockText(hour);
    if (E.phase) E.phase.textContent = dayPhase(hour);
    if (E.todLabel) E.todLabel.textContent = clockText(hour);
    if (E.tod && document.activeElement !== E.tod) E.tod.value = String(Math.round(hour * 60) % 1440);
  }

  /** 地形横剖（真实数据，作为速度曲线的背景） */
  setTerrain(samples) { this._terrain = samples; this._drawProfile(); }

  /** 每帧：速度表 + 曲线 + 节流后的文字 */
  tick(app, st) {
    const kmh = Math.max(0, st.speedKmh ?? 0);
    // 速度历史
    const h = this._hist;
    if (this._histN === 0) h.fill(kmh);
    h.copyWithin(0, 1); h[h.length - 1] = kmh; this._histN++;
    this._speedoAcc += 1;
    if (this._speedoAcc > 1 && (Math.abs(kmh - this._lastKmh) > 0.12 || this._speedoAcc > 20)) {
      this._speedoAcc = 0; this._lastKmh = kmh;
      this._drawSpeedo(kmh, st, app);
      this._drawProfile();
    }
    // 文字（每 ~0.45 秒）
    this._txtAcc = (this._txtAcc || 0) + (app._dt || 0.016);
    if (this._txtAcc > 0.45) {
      this._txtAcc = 0;
      const E = this.el, sim = app.sim, env = app.env;
      if (E.cad) E.cad.textContent = Math.round(st.cadence);
      if (E.gear) E.gear.textContent = (sim.odo / 1000).toFixed(2);
      if (E.pow) E.pow.textContent = Math.round(sim.stamina * 100);
      if (E.dist) E.dist.textContent = (sim.odo / 1000).toFixed(3) + ' km';
      if (E.climb) E.climb.textContent = (sim.elapsed > 1 ? (sim.odo / 1000) / (sim.elapsed / 3600) : 0).toFixed(1) + ' km/h';
      if (E.temp) E.temp.textContent = tempAt(app.timeHour).toFixed(0) + '°C';
      if (E.wind) E.wind.textContent = windAt(app.elapsed).toFixed(1) + ' m/s';
      if (E.strip) {
        const s = app.stats, info = app.renderer.info;
        E.strip.innerHTML =
          `<span class="stat">FPS <b>${app.fps.toFixed(0)}</b></span>` +
          `<span class="stat">绘制 <b>${info.render.calls}</b></span>` +
          `<span class="stat">帧三角 <b>${fmt(info.render.triangles)}</b></span>` +
          `<span class="stat">场景网格 <b>${s.meshes}</b></span>` +
          `<span class="stat">场景三角 <b>${fmt(s.tris)}</b></span>` +
          `<span class="stat">着色器 <b>${info.programs ? info.programs.length : 0}</b></span>` +
          `<span class="stat">夜幕 <b>${(env.night * 100).toFixed(0)}%</b></span>` +
          `<span class="stat">HDR <b>${app.pixelRatio.toFixed(2)}×</b></span>`;
      }
    }
  }

  /* ------------------------------------------------------------ 速度表绘制 */
  _drawSpeedo(kmh, st, app) {
    const ctx = this._ctx, c = this.el.speedo;
    if (!ctx || !c) return;
    const W = c._w, H = c._h, cx = W / 2, cy = H / 2 + 6, R = W * 0.40;
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, MAX = 80;
    const ang = (v) => A0 + clamp(v / MAX, 0, 1) * (A1 - A0);
    ctx.clearRect(0, 0, W, H);

    // 底盘
    ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,24,.55)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,175,255,.16)'; ctx.stroke();

    // 轨道
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, R, A0, A1);
    ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.stroke();
    // 红区
    ctx.beginPath(); ctx.arc(cx, cy, R, ang(58), A1);
    ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(255,90,90,.30)'; ctx.stroke();
    // 当前值
    const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    g.addColorStop(0, '#4fd1ff'); g.addColorStop(0.55, '#ffb43c'); g.addColorStop(1, '#ff6b6b');
    ctx.beginPath(); ctx.arc(cx, cy, R, A0, ang(kmh));
    ctx.lineWidth = 9; ctx.strokeStyle = g; ctx.stroke();

    // 刻度
    for (let v = 0; v <= MAX; v += 5) {
      const a = ang(v), major = v % 20 === 0;
      const r0 = R - 13, r1 = R - (major ? 25 : 19);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineWidth = major ? 2 : 1;
      ctx.strokeStyle = major ? 'rgba(230,240,255,.72)' : 'rgba(200,215,255,.34)';
      ctx.stroke();
      if (major) {
        ctx.font = '600 10px ui-monospace,monospace';
        ctx.fillStyle = 'rgba(200,215,255,.66)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(v), cx + Math.cos(a) * (R - 36), cy + Math.sin(a) * (R - 36));
      }
    }
    // 体力环
    const sr = R - 46;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, sr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (app.sim.stamina ?? 1));
    ctx.lineWidth = 3; ctx.strokeStyle = st.boost ? '#ff9a4a' : '#4be08b'; ctx.stroke();

    // 指针
    const a = ang(kmh);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(a);
    ctx.shadowColor = 'rgba(255,180,60,.75)'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(R - 20, 0);
    ctx.lineWidth = 3.4; ctx.strokeStyle = '#ffd79a'; ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1020'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffb43c'; ctx.stroke();

    // 数字
    ctx.textAlign = 'center';
    ctx.font = '700 34px ui-monospace,monospace';
    ctx.fillStyle = '#f2f5ff';
    ctx.fillText(kmh.toFixed(0), cx, cy + R * 0.58);
    ctx.font = '600 10px ui-monospace,monospace';
    ctx.fillStyle = 'rgba(147,160,192,.9)';
    ctx.fillText('KM/H', cx, cy + R * 0.58 + 15);
    if (st.boost) {
      ctx.font = '700 11px ui-monospace,monospace';
      ctx.fillStyle = '#ff9a4a';
      ctx.fillText('冲刺 SPRINT', cx, cy - R * 0.30);
    } else if (st.hopAir) {
      ctx.font = '700 11px ui-monospace,monospace';
      ctx.fillStyle = '#4fd1ff';
      ctx.fillText('腾空 AIR', cx, cy - R * 0.30);
    }
  }

  _drawProfile() {
    const ctx = this._pctx, c = this.el.profile;
    if (!ctx || !c) return;
    const W = c._w, H = c._h;
    ctx.clearRect(0, 0, W, H);
    // 地形背景
    if (this._terrain) {
      const t = this._terrain, n = t.length;
      let mn = Infinity, mx = -Infinity;
      for (const v of t) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      const sc = (mx - mn) || 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * W, y = H - 6 - ((t[i] - mn) / sc) * (H - 22);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      ctx.fillStyle = 'rgba(120,150,220,.16)'; ctx.fill();
      ctx.strokeStyle = 'rgba(150,180,255,.32)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // 速度曲线
    const hist = this._hist, n = hist.length, MAX = 80;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W, y = H - 6 - clamp(hist[i] / MAX, 0, 1) * (H - 22);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = '#ffb43c'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
    const lastY = H - 6 - clamp(hist[n - 1] / MAX, 0, 1) * (H - 22);
    ctx.beginPath(); ctx.arc(W - 3, lastY, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd79a'; ctx.fill();
    ctx.font = '9px ui-monospace,monospace'; ctx.fillStyle = 'rgba(147,160,192,.8)';
    ctx.textAlign = 'left'; ctx.fillText('80', 3, 11);
    ctx.fillText('0', 3, H - 9);
  }

  /* -------------------------------------------------------------- 加载与提示 */
  loading(p, msg) {
    const E = this.el;
    if (E.bootBar) E.bootBar.style.width = `${clamp(p, 0, 1) * 100}%`;
    if (msg && E.bootMsg) E.bootMsg.textContent = msg;
  }
  ready() {
    this.el.boot?.classList.add('hidden');
    const errs = window.__PELICAN_ERRORS__ || [];
    if (errs.length) this.toast(`⚠ 运行期捕获 ${errs.length} 个错误：${errs[0].slice(0, 90)}`, 8000);
  }
  toast(msg, ms = 2200) {
    const t = this.el.toast;
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
  showHelp(on) { this.el.help?.classList.toggle('hidden', !on); }
  setUIVisible(v) {
    this._uiVisible = v;
    for (const el of [this.el.topbar, this.el.left, this.el.right, this.el.controls, this.el.touch]) {
      el?.classList.toggle('hidden', !v);
    }
    this.toast(v ? '界面已显示' : '界面已隐藏（按 H 恢复）', 2600);
  }
  toggleUI() { this.setUIVisible(!this._uiVisible); }

  /* ------------------------------------------------------------------ 其他 */
  _fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
  setRecording(on) {
    this.markAction('record', on);
    const b = document.querySelector('[data-action="record"]');
    if (b) b.textContent = on ? '⏹ 停止' : '⏺ 录制';
  }
}

const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n));
const css = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : String(c || '#888'));
