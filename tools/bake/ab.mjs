#!/usr/bin/env node
/**
 * ab.mjs —— 同一场景下对比「程序化伪 3D」与「Blender 烘焙贴图」两种机枪塔。
 *   node ab.mjs 1  → 烘焙模式（默认）
 *   node ab.mjs 0  → 程序化模式（?bake=0）
 */
const FS = await import('node:fs');
const CDP = 'http://127.0.0.1:9222';
const MODE = process.argv[2] === '0' ? '0' : '1';
const URL = 'http://127.0.0.1:7777/' + (MODE === '0' ? '?bake=0' : '');
const OUT = '/tmp/bl/shot-bake' + MODE + '.png';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const target = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise(res => {
  const mid = ++id; pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});
await new Promise(r => { ws.onopen = r; });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const ev = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description);
  return r.result && r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(3000);
await ev('Sprites.ready()', true);
await ev('typeof Bake !== "undefined" && Bake.ready()', true);

console.log('[diag] Bake 定义 =', await ev('typeof Bake'));
console.log('[diag] enabled   =', await ev('typeof Bake!=="undefined" && Bake.enabled'));
console.log('[diag] loaded    =', await ev('typeof Bake!=="undefined" && Bake.loaded'));
console.log('[diag] meta      =', await ev('typeof BAKE_META!=="undefined" ? JSON.stringify(BAKE_META) : "BAKE_META undefined"'));

const r = await ev(`(function(){
  const g = UI.launch(); g.speed = 1; g.money = 999999;
  const placed = [];
  const rowPref = [4, 3, 5, 2, 6, 1, 7];
  for (const rr of rowPref) {
    for (let cc = 1; cc <= 18 && placed.length < 6; cc++) {
      if (g.placeTower(cc, rr, 'gatling')) placed.push([cc, rr]);
    }
    if (placed.length >= 6) break;
  }
  const aims = [0, 60, 120, 180, 240, 300];
  g.towers.forEach((tw, i) => { tw.spawnT = 1; tw.aim = aims[i % 6] * Math.PI / 180; });
  return JSON.stringify({ n: g.towers.length, placed });
})()`);
console.log('[towers]', r);

/* 等 ROUND 1 横幅消失，再重新锁定朝向（update 可能把它转回去了） */
await sleep(3200);
await ev(`(function(){ const a=[0,60,120,180,240,300];
  UI.game.towers.forEach((tw,i)=>{ tw.spawnT=1; tw.aim=a[i%6]*Math.PI/180; });
  UI.game.banner = null; return 1; })()`);
await sleep(400);
console.log('[final aims]', await ev('JSON.stringify(UI.game.towers.map(t=>Math.round(t.aim*180/Math.PI)))'));

const shot = await send('Page.captureScreenshot', { format: 'png' });
FS.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

/* 裁出炮塔所在行 */
const box = await ev(`(function(){
  const ts = UI.game.towers; if(!ts.length) return null;
  const xs = ts.map(t=>t.x), ys = ts.map(t=>t.y);
  return JSON.stringify({ x: Math.min(...xs), y: Math.min(...ys) });
})()`);
const b = JSON.parse(box);
const cx = Math.max(0, Math.round(b.x) - 70), cy = Math.max(0, Math.round(b.y) - 80);
const clip = await send('Page.captureScreenshot', {
  format: 'png', clip: { x: cx, y: cy, width: Math.min(1280 - cx, 760), height: 180, scale: 2 }
});
FS.writeFileSync(OUT.replace('.png', '-crop.png'), Buffer.from(clip.data, 'base64'));
console.log('saved', OUT, '+ crop @', cx, cy);

await fetch(CDP + '/json/close/' + target.id);
ws.close();
process.exit(0);
