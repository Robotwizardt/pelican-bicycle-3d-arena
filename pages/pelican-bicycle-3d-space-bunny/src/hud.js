/**
 * hud.js —— 界面层（纯 DOM，不引入任何 UI 库）
 *
 * 结构：
 *  - 左上：品牌 + 副标题 + 实时读数（速度/踏频/里程/圈数/送达/渔获）
 *  - 右上：相机模式 + 天气 + 时间 + 静音 + 画质
 *  - 底部中央：时间轴滑块（太阳时刻）+ 天气/风
 *  - 左下：解剖学「冷知识」卡片（轮播）
 *  - 中央：事件吐司（钓鱼成功 / 投递完成 / 第 N 圈 …）
 *  - 开场遮罩：点击开始（同时解锁音频）
 *  - 移动端：折叠为顶部一条 + 底部抽屉
 *
 * 所有 HUD 都订阅 ride 的事件（onEvent），因此本作的「玩法」就是看鹈鹕跑。
 */
import { clamp01, formatNum } from './util.js';
import { WEATHERS } from './weather.js';

export function createHud({ ride, weather, audio, onQuality }) {
  const el = (id) => document.getElementById(id);
  const hud = el('hud');
  const toastEl = el('toast');
  const loadingEl = el('loading');

  /* ---------------- 读数 ---------------- */
  const speedEl = el('speedVal');
  const cadenceEl = el('cadenceVal');
  const odoEl = el('odoVal');
  const lapEl = el('lapVal');
  const bagEl = el('bagVal');
  const fishEl = el('fishVal');
  const timeEl = el('clockVal');
  const weatherEl = el('weatherVal');
  const camEl = el('camVal');
  const windEl = el('windVal');
  const moodEl = el('moodVal');

  /* ---------------- 冷知识卡片 ---------------- */
  const FACTS = [
    { title: '鹈鹕不会飞着送快递', body: '鹈鹕是游禽：脚短、腿在身体下方，重心靠后。它能靠全蹼足在水面「犁行」，但踩踏板不在它的技能树里。' },
    { title: '喉囊 = 渔网', body: '下颌之间那层无羽皮肤就是「喉囊（gular pouch）」。捕鱼时像吊网一样兜住鱼；撑满时能装下比自己肚子还多的水。' },
    { title: '全蹼足 totipalmate', body: '鹈鹕四根脚趾全部连蹼，划水面积翻倍。所以这页里「蹼足压踏板」不是失误，是它的宿命。' },
    { title: '初级飞羽才黑', body: '大白鹈鹕通体白羽，只有初级与次级飞羽黑——所以静止时像只白鸟，起飞瞬间才露出「黑翅膀」。' },
    { title: '名字来自驴叫', body: 'Pelecanus onocrotalus：onokrotalos 意为「像驴叫一样」，指它低沉的求偶叫。' },
    { title: '上喙末端有钩爪', body: '上喙尖向下弯成一枚「爪」，像钩子一样钩住滑溜的鱼——所以鹈鹕是「钩」而不是「夹」。' },
  ];
  const factEl = el('factCard');
  let factIdx = 0;
  function showFact() {
    const f = FACTS[factIdx % FACTS.length];
    factEl.innerHTML = `<h4>${f.title}</h4><p>${f.body}</p>`;
    factIdx++;
  }
  showFact();
  setInterval(showFact, 9000);

  /* ---------------- 事件 → 吐司 ---------------- */
  let toastTimer = 0;
  function toast(html, ms = 2600) {
    toastEl.innerHTML = html;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  ride.onEvent((type, data) => {
    switch (type) {
      case 'fish':
        toast(`🎣 <b>战利品 +1</b>　喉囊又鼓了一点　<span class="mono">共 ${data} 条</span>`);
        break;
      case 'deliver':
        toast(`📮 <b>投递完成</b>　灯塔邮局的窗子收到了　<span class="mono">今日 ${data} 件</span>`);
        break;
      case 'light':
        toast(`🗼 <b>灯塔问候</b>　光束扫过你的头顶`);
        break;
      case 'lap':
        toast(`🏁 <b>第 ${data} 圈</b>　环岛邮路全长 ${ride.capeLength ? ride.capeLength.toFixed(0) : ''} m`);
        break;
      case 'mode':
        if (data.mode === 'manual') toast(`🎮 <b>手动驾驶</b>　W/S 加速 · 空格刹车 · M 回到自动`);
        if (data.label && data.mode !== 'manual') toast(`📍 ${data.label}`);
        break;
      case 'camera':
        toast(`🎥 相机：<b>${cameraName(data)}</b>`);
        break;
      default:
        break;
    }
  });

  function cameraName(m) {
    return (
      {
        chase: '追尾跟拍',
        pelican: '鹈鹕第一视角',
        orbit: '电影环绕',
        free: '自由漫游',
      }[m] || m
    );
  }

  /* ---------------- 时间轴滑块 ---------------- */
  const timeSlider = el('timeSlider');
  timeSlider.value = String(weather.hour);
  timeSlider.addEventListener('input', () => {
    weather.hour = Number(timeSlider.value);
    if (weather.autoTime) weather.autoTime = false;
  });

  /* ---------------- 天气按钮 ---------------- */
  const weatherRow = el('weatherRow');
  WEATHERS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = w;
    b.addEventListener('click', () => {
      weather.weather = i;
      refreshWeatherChips();
    });
    weatherRow.appendChild(b);
  });
  function refreshWeatherChips() {
    [...weatherRow.children].forEach((c, i) => c.classList.toggle('on', i === Math.round(weather.weather)));
  }
  refreshWeatherChips();

  /* ---------------- 滑杆：风力 ---------------- */
  const windSlider = el('windSlider');
  windSlider.value = String(weather.wind * 100);
  windSlider.addEventListener('input', () => {
    weather.wind = Number(windSlider.value) / 100;
  });

  /* ---------------- 按钮：相机/静音/画质/飞行/驾驶 ---------------- */
  el('btnCam').addEventListener('click', () => {
    ride.cycleCamera();
    camEl.textContent = cameraName(ride.cam.mode);
  });
  camEl.textContent = cameraName(ride.cam.mode);

  const btnMute = el('btnMute');
  btnMute.addEventListener('click', () => {
    const m = audio.toggleMute();
    btnMute.textContent = m ? '🔇' : '🔊';
  });

  const qualitySel = el('qualitySel');
  qualitySel.addEventListener('change', () => onQuality(qualitySel.value));

  el('btnFlight').addEventListener('click', () => ride.launchFlight());
  el('btnDrive').addEventListener('click', () => ride.toggleManual());

  /* ---------------- 自动时间开关 ---------------- */
  const btnAuto = el('btnAuto');
  btnAuto.addEventListener('click', () => {
    weather.autoTime = !weather.autoTime;
    btnAuto.textContent = weather.autoTime ? '⏱ 自动' : '⏱ 手动';
    btnAuto.classList.toggle('on', weather.autoTime);
  });
  btnAuto.classList.add('on');

  /* ---------------- 开场遮罩 ---------------- */
  const startBtn = el('startBtn');
  const overlay = el('overlay');
  function begin() {
    overlay.classList.add('hidden');
    document.body.classList.remove('pre'); // CSS 用 body.pre 隐藏 HUD
    audio.start();
    audio.whistle();
    ride.beginCruising?.();
  }
  startBtn.addEventListener('click', begin);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) begin();
  });

  /* ---------------- 每帧刷新读数 ---------------- */
  let acc = 0;
  function update(dt, state) {
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    speedEl.textContent = (state.speed * 3.6).toFixed(1);
    // 踏频 rpm：曲柄角速度 / 2π * 60
    const cadence = (state.speed / (0.34 * Math.PI * 2)) / state.pedalRatio * 60;
    cadenceEl.textContent = cadence.toFixed(0);
    odoEl.textContent = formatNum(state.odometer, 0);
    lapEl.textContent = String(state.lapCount);
    bagEl.textContent = String(state.delivered);
    fishEl.textContent = String(state.fish);
    const h = Math.floor(weather.hour);
    const m = Math.floor((weather.hour - h) * 60);
    timeEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    weatherEl.textContent = WEATHERS[Math.round(weather.weather)];
    windEl.textContent = (weather.wind * 100).toFixed(0);
  }

  function setMood(label, color) {
    moodEl.textContent = label;
    moodEl.style.color = color;
  }

  return {
    update,
    toast,
    begin,
    setMood,
    loading: loadingEl,
    el: hud,
    dispose() {
      clearInterval(showFact && 0);
    },
  };
}