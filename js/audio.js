/* ============================================================
   audio.js — 纯程序化音效（WebAudio，无外部素材）
   ------------------------------------------------------------
   设计目标：不再是「单薄的一声电子音」，而是有层次的音效。
   每条音效 = 多个合成层叠加（瞬态 + 主体 + 尾巴），
   并且：
     · 立体声定位 —— 按声源在战场上的 x 坐标左右分布；
     · 混响尾巴   —— 程序化脉冲响应，做出空间感；
     · 总线压缩   —— 多塔齐射时不会爆音；
     · 环境底噪   —— 极轻的风声，让静音时有「空气感」。
   ============================================================ */
const Sfx = (() => {
  let ctx = null, enabled = true;
  let master = null, comp = null, dry = null, revIn = null, revOut = null;
  let noiseBuf = null, ambSrc = null, ambGain = null, ambFilter = null;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();

      /* --- 总线：压缩器 -> 主音量 -> 输出 --- */
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 22;
      comp.ratio.value = 7; comp.attack.value = 0.004; comp.release.value = 0.25;
      master = ctx.createGain(); master.gain.value = 0.34;
      comp.connect(master); master.connect(ctx.destination);

      /* --- 干声：一层很轻的低通，声音更厚、不刺耳 --- */
      dry = ctx.createGain(); dry.gain.value = 1;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 13000;
      dry.connect(lp); lp.connect(comp);

      /* --- 混响支路：程序化脉冲响应 --- */
      revIn = ctx.createGain(); revIn.gain.value = 1;
      const conv = ctx.createConvolver();
      conv.buffer = makeIR(1.15, 2.8);
      revOut = ctx.createGain(); revOut.gain.value = 0.34;
      revIn.connect(conv); conv.connect(revOut); revOut.connect(comp);

      /* --- 白噪声缓冲 --- */
      const len = Math.floor(ctx.sampleRate * 1.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }

  /* 程序化混响 IR：极短的早期反射 + 指数衰减的扩散尾巴 */
  function makeIR(dur, decay) {
    const rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * dur));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const early = i < rate * 0.01 ? 0.42 : 1;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * early;
      }
    }
    return buf;
  }

  function resume() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setEnabled(v) {
    enabled = v;
    if (master) master.gain.value = v ? 0.34 : 0;
  }
  function isEnabled() { return enabled; }

  /* 每条音效的出口节点：左右定位 + 按需送混响 */
  function bus(pan, rev) {
    if (!ctx || !enabled) return null;
    const out = ctx.createGain();
    let node = out;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan || 0, -1, 1);
      out.connect(p); node = p;
    }
    node.connect(dry);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; node.connect(s); s.connect(revIn); }
    return out;
  }

  /* 振荡器层 */
  function tone(dest, freq, dur, type, vol, slideTo, delay) {
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.3 : vol, t0 + Math.min(0.008, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  /* 噪声层（可扫频、可选滤波类型） */
  function noise(dest, dur, vol, f0, q, f1, delay, type, slide) {
    const t0 = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.setValueAtTime(f0, t0);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + (slide || dur));
    f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.3 : vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0); s.stop(t0 + dur + 0.03);
  }

  /* 音量按同帧触发次数自适应，避免连射时糊成一团 */
  let shotCount = 0, shotT = 0;
  function throttle() {
    const now = performance.now();
    if (now - shotT > 90) { shotT = now; shotCount = 0; }
    shotCount++;
    return Math.min(1, 1 / Math.sqrt(shotCount));
  }

  /* ---------------- 环境底噪（极轻的风声） ---------------- */
  function ambience(on) {
    if (!ctx) return;
    if (on) {
      if (ambSrc) return;
      ambSrc = ctx.createBufferSource();
      ambSrc.buffer = noiseBuf; ambSrc.loop = true;
      ambFilter = ctx.createBiquadFilter();
      ambFilter.type = 'bandpass'; ambFilter.frequency.value = 420; ambFilter.Q.value = 0.7;
      ambGain = ctx.createGain(); ambGain.gain.value = 0;
      ambSrc.connect(ambFilter); ambFilter.connect(ambGain); ambGain.connect(dry);
      ambSrc.start();
      ambGain.gain.linearRampToValueAtTime(0.020, ctx.currentTime + 1.6);
      // 缓慢起伏，像旷野的风
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 0.09; lg.gain.value = 150;
      lfo.connect(lg); lg.connect(ambFilter.frequency);
      lfo.start();
    } else if (ambSrc) {
      try { ambSrc.stop(); } catch (e) {}
      ambSrc = null; ambGain = null; ambFilter = null;
    }
  }

  return {
    init, resume, setEnabled, isEnabled, ambience,

    /* --- 炮塔开火 --- */
    gatling(pan) {
      const v = throttle(); const d = bus(pan, 0.18); if (!d) return;
      noise(d, 0.045, 0.10 * v, 3200, 1.4, 900, 0, 'bandpass', 0.03);
      tone(d, 340, 0.045, 'square', 0.085 * v, 150);
      tone(d, 95, 0.06, 'sine', 0.05 * v, 60);
    },
    gooShot(pan) {
      const v = throttle(); const d = bus(pan, 0.26); if (!d) return;
      tone(d, 190, 0.19, 'sine', 0.16 * v, 68);
      tone(d, 196, 0.15, 'triangle', 0.06 * v, 74, 0.01);
      noise(d, 0.15, 0.07 * v, 950, 1.2, 220);
    },
    missile(pan) {
      const v = throttle(); const d = bus(pan, 0.34); if (!d) return;
      // 发射管里的「噗」+ 喷流的呼啸 + 低频推力
      noise(d, 0.09, 0.15 * v, 420, 0.8, 180, 0, 'bandpass', 0.06);
      noise(d, 0.52, 0.14 * v, 380, 1.6, 2100, 0.03, 'bandpass', 0.5);
      tone(d, 88, 0.42, 'sawtooth', 0.10 * v, 58);
      tone(d, 150, 0.5, 'triangle', 0.05 * v, 96, 0.02);
    },
    flame(pan) {
      const v = throttle(); const d = bus(pan, 0.12); if (!d) return;
      noise(d, 0.2, 0.055 * v, 1150, 0.8, 520);
      noise(d, 0.1, 0.03 * v, 2600, 1.6, 1400, 0.02, 'bandpass', 0.06);
    },
    tesla(pan) {
      const v = throttle(); const d = bus(pan, 0.5); if (!d) return;
      // 三道错开的爆裂噪声 = 电弧「啪啦」感
      for (let i = 0; i < 3; i++) {
        noise(d, 0.035, 0.075 * v, 4600, 2.2, 1600, i * 0.017, 'bandpass', 0.03);
      }
      tone(d, 1450, 0.16, 'sawtooth', 0.10 * v, 300);
      tone(d, 2700, 0.09, 'square', 0.045 * v, 880);
      tone(d, 620, 0.2, 'sine', 0.05 * v, 180, 0.02);
    },
    mortarFire(pan) {
      const v = throttle(); const d = bus(pan, 0.5); if (!d) return;
      tone(d, 122, 0.24, 'square', 0.21 * v, 46);
      tone(d, 62, 0.3, 'sine', 0.14 * v, 34);
      noise(d, 0.26, 0.19 * v, 720, 1, 140);
      noise(d, 0.07, 0.09 * v, 3400, 2, 1500, 0.01, 'bandpass', 0.05);
    },

    /* --- 爆炸（尺寸 0.4~2.2） --- */
    boom(size, pan) {
      const v = throttle(); const d = bus(pan, 0.55); if (!d) return;
      const s = clamp(size || 1, 0.4, 2.2);
      tone(d, 74 / s, 0.5 * s, 'sine', 0.2 * v, 28);           // 次低频轰
      noise(d, 0.4 * s, 0.23 * v, 900 * s, 1, 90);              // 主体轰鸣
      noise(d, 0.06, 0.13 * v, 2800, 1.4, 900, 0, 'bandpass', 0.05); // 起爆脆响
      // 碎屑噼啪
      for (let i = 0; i < 4; i++) noise(d, 0.05, 0.05 * v, 1800 + Math.random() * 2200, 2.4, 700, 0.1 + Math.random() * 0.35, 'bandpass', 0.04);
    },

    /* --- 建造 / 升级 / 出售 --- */
    build(pan) {
      const d = bus(pan, 0.22); if (!d) return;
      noise(d, 0.09, 0.13, 800, 1, 240);      // 落锤
      tone(d, 420, 0.1, 'square', 0.16);
      tone(d, 660, 0.13, 'square', 0.14, null, 0.075);
    },
    upgrade(pan) {
      const d = bus(pan, 0.32); if (!d) return;
      [523, 659, 784, 1047].forEach((f, i) => tone(d, f, 0.14, 'square', 0.14, null, i * 0.06));
      noise(d, 0.3, 0.05, 5200, 1.6, 2600, 0.02, 'bandpass', 0.26);  // 金属闪光
    },
    sell(pan) {
      const d = bus(pan, 0.22); if (!d) return;
      [700, 520, 380].forEach((f, i) => tone(d, f, 0.12, 'triangle', 0.15, null, i * 0.055));
      tone(d, 1180, 0.07, 'square', 0.09, null, 0.17);
    },

    /* --- UI --- */
    coin() { const d = bus(0, 0.2); if (!d) return; tone(d, 1180, 0.07, 'square', 0.10); tone(d, 1560, 0.09, 'square', 0.09, null, 0.05); },
    deny() { const d = bus(0, 0.1); if (!d) return; tone(d, 165, 0.16, 'square', 0.19, 88); tone(d, 82, 0.16, 'sawtooth', 0.08, 60); },
    click() { const d = bus(0, 0.08); if (!d) return; noise(d, 0.02, 0.09, 3600, 1.4, 1600, 0, 'bandpass', 0.015); tone(d, 880, 0.045, 'square', 0.1); },
    hover() { const d = bus(0, 0.06); if (!d) return; tone(d, 1300, 0.03, 'sine', 0.045); },

    /* --- 战况 --- */
    leak(pan) {
      const d = bus(pan, 0.45); if (!d) return;
      tone(d, 320, 0.32, 'sawtooth', 0.2, 78);
      tone(d, 160, 0.36, 'square', 0.1, 60, 0.02);
      noise(d, 0.32, 0.15, 520, 1, 100);
    },
    roundStart() {
      const d = bus(0, 0.45); if (!d) return;
      [392, 523, 659].forEach((f, i) => { tone(d, f, 0.22, 'triangle', 0.14, null, i * 0.1); tone(d, f * 1.005, 0.22, 'sawtooth', 0.04, null, i * 0.1); });
      noise(d, 0.18, 0.07, 2400, 1.2, 800, 0.28, 'bandpass', 0.16);
    },
    gameOver() {
      const d = bus(0, 0.6); if (!d) return;
      [440, 349, 262, 196].forEach((f, i) => { tone(d, f, 0.45, 'sawtooth', 0.17, null, i * 0.22); tone(d, f / 2, 0.5, 'sine', 0.09, null, i * 0.22); });
    },
    victory() {
      const d = bus(0, 0.55); if (!d) return;
      [523, 659, 784, 1047, 1319].forEach((f, i) => { tone(d, f, 0.32, 'square', 0.15, null, i * 0.12); tone(d, f * 1.5, 0.3, 'triangle', 0.06, null, i * 0.12 + 0.03); });
      tone(d, 1568, 0.5, 'square', 0.12, null, 0.62);
    }
  };
})();
