/**
 * input.js — 键盘 / 指针 / 触摸 / 游戏手柄 → 连续轴 + 边沿动作
 * 轴：throttle(-1..1)  brake(0..1)  steer(-1..1)  lookX/lookY(-1..1)  zoom(-1..1)
 */
const KEYMAP = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  hop: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  manual: ['ControlLeft', 'ControlRight'],
};

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this._edge = new Set();
    this.pointer = { active: false, dx: 0, dy: 0, zoom: 0, dragging: false };
    this.touch = { left: false, right: false };
    this.virtual = { active: false, throttle: 0, brake: 0, steer: 0 };   // 触屏摇杆写入
    this.padIndex = -1;
    this.axes = { throttle: 0, brake: 0, steer: 0, lookX: 0, lookY: 0, boost: 0 };
    this.state = { throttle: 0, brake: 0, steer: 0, lookX: 0, lookY: 0, boost: 0, auto: false };
    this._dom = dom;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this._edge.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', (e) => {
      this.pointer.dragging = true; this.pointer.active = true;
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    });
    addEventListener('pointerup', () => { this.pointer.dragging = false; });
    addEventListener('pointermove', (e) => {
      if (!this.pointer.dragging) return;
      this.pointer.dx += (e.clientX - this.pointer.x) / innerWidth;
      this.pointer.dy += (e.clientY - this.pointer.y) / innerHeight;
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
    });
    dom.addEventListener('wheel', (e) => { this.pointer.zoom += Math.sign(e.deltaY) * 0.5; e.preventDefault(); }, { passive: false });

    // 触摸：左右半屏轻点转向（移动端友好）
    dom.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth / 2) this.touch.left = true; else this.touch.right = true;
      }
    }, { passive: true });
    dom.addEventListener('touchend', () => { this.touch.left = false; this.touch.right = false; }, { passive: true });

    addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.padIndex = -1; });
  }

  axis(neg, pos) {
    let v = 0;
    if (neg.some((k) => this.keys.has(k))) v -= 1;
    if (pos.some((k) => this.keys.has(k))) v += 1;
    return v;
  }
  /** 边沿动作：同一次按键只触发一次 */
  take(code) {
    if (this._edge.has(code)) { this._edge.delete(code); return true; }
    return false;
  }
  endFrame() { this._edge.clear(); }

  update(dt, { autoRide = false } = {}) {
    const K = KEYMAP;
    let th = this.axis([], K.throttle);
    let br = this.axis([], K.brake);
    let st = this.axis(K.left, K.right);
    let boost = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? 1 : 0;

    if (this.touch.left) st -= 1;
    if (this.touch.right) st += 1;
    // 触屏摇杆（HUD 写入的虚拟轴）
    if (this.virtual.active) {
      th += this.virtual.throttle;
      br = Math.max(br, this.virtual.brake);
      st += this.virtual.steer;
    }

    // 手柄
    if (this.padIndex >= 0) {
      const gp = navigator.getGamepads?.()[this.padIndex];
      if (gp) {
        const dz = (v) => (Math.abs(v) > 0.12 ? v : 0);
        st += dz(gp.axes[0] || 0);
        if ((gp.buttons[7]?.value || 0) > 0.05) th += gp.buttons[7].value;
        if ((gp.buttons[6]?.value || 0) > 0.05) br += gp.buttons[6].value;
        const rt = gp.buttons[7]?.value, lt = gp.buttons[6]?.value;
        if (rt === undefined && lt === undefined) {
          th += -dz(gp.axes[1] || 0);
        }
        if (gp.buttons[0]?.pressed) this._edge.add('Space');
        boost = Math.max(boost, gp.buttons[1]?.pressed ? 1 : 0);
      }
    }
    if (br < 0) { th += br; br = 0; }
    br = Math.min(1, Math.max(0, br));

    if (autoRide && th <= 0.01 && br < 0.1) th = 0.62;   // 演示 / 移动端自动巡航

    const rate = (cur, target, up, down) =>
      cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));
    const S = this.state;
    S.throttle = rate(S.throttle, th, 3.4, 6);
    S.brake = rate(S.brake, br, 9, 5);
    S.steer = rate(S.steer, Math.max(-1, Math.min(1, st)), 5.5, 7);
    S.boost = rate(S.boost, boost, 5, 3);

    // 视角（指针拖动 → 入轴的相对量）
    this.pointer.dx = Math.min(0.25, Math.max(-0.25, this.pointer.dx));
    this.pointer.dy = Math.min(0.25, Math.max(-0.25, this.pointer.dy));
    S.lookX = this.pointer.dx * 3.2;
    S.lookY = this.pointer.dy * 2.0;
    S.zoom = this.pointer.zoom;
    this.pointer.dx = 0; this.pointer.dy = 0; this.pointer.zoom = 0;
    return S;
  }
}
