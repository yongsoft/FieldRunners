/* ============================================================
   r3d/core.js — 渲染核心

   职责：WebGL 渲染器 / 正交相机 / 灯光 / 环境贴图 / 后期链 / 材质工厂。

   投影（关键）：游戏的伪 3D 是
       屏幕 x = 世界 X
       屏幕 y = 地面 y − 高度 · HZ        (HZ = 0.90)
       地面 y 方向被压 K = 0.46
   这**正好等于**一台俯角 θ = asin(0.46) = 27.386° 的正交相机，
   相机 target 放在视口中心、ortho 尺寸等于视口像素时，
   世界 (x, 高度, y/K) 投影回来就等于画布坐标 —— 不需要任何手工对位常数。
   ============================================================ */
import * as THREE from 'three';
import {
  envCanvas, armorNormal, metalRoughness, glowSprite,
} from './tex.js';

export const K = 0.46;
export const THETA = Math.asin(K);
export const COS_T = Math.cos(THETA);
export const HZ = 0.90;

/* 3D 只铺场地那 576px；底部 144px 是 HUD 木栏，仍由 2D 画布绘制 */
export const VIEW_W = 1280;
export const VIEW_H = 576;

/* 全局开关：出问题可以逐项关掉定位 */
export const CFG = {
  shadows: true,
  bloom: true,
  wear: true,          // 世界空间磨损噪声（材质 onBeforeCompile）
  msaa: 4,
};

export const w2s = (y) => y;             // 画布 y ↔ 屏幕 y
export const cz = (canvasY) => canvasY / K;   // 画布 y → 世界 Z

/* ================================================================ 材质 */

const _matCache = new Map();

/**
 * 把「世界空间磨损」注入 MeshStandardMaterial。
 *
 * 为什么不用贴图：模型是几十个不同尺寸的零件合批出来的，
 * UV 尺度各不相同，贴图细节密度会忽大忽小。
 * 用世界坐标采样噪声，密度就与零件尺寸无关，看起来才像「同一个工艺」。
 */
function injectWear(mat, scale, amount) {
  if (!CFG.wear || amount <= 0) return mat;
  const key = 'wear' + scale + ':' + amount;
  mat.userData.wearKey = key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWScale = { value: scale };
    shader.uniforms.uWAmt = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uWScale;
uniform float uWAmt;
float _h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float _vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = _h21(i), b = _h21(i + vec2(1.0, 0.0));
  float c = _h21(i + vec2(0.0, 1.0)), d = _h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float wearAt(vec3 p){
  float n = _vn(p.xz * uWScale) * 0.52
          + _vn(p.xy * uWScale * 1.73 + 11.0) * 0.30
          + _vn(p.zy * uWScale * 0.71 + 37.0) * 0.18;
  return n;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float w = wearAt(vWPos);
  diffuseColor.rgb *= (1.0 - uWAmt * 0.5) + w * uWAmt;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{
  float w2 = wearAt(vWPos + 5.0);
  roughnessFactor = clamp(roughnessFactor * (0.88 + w2 * 0.26), 0.05, 1.0);
}`);
  };
  mat.customProgramCacheKey = () => 'wear' + scale + '_' + amount;
  return mat;
}

function m(envTex, opts) {
  const mat = new THREE.MeshStandardMaterial({
    envMap: envTex,
    envMapIntensity: opts.env === undefined ? 0.55 : opts.env,
    metalness: opts.metal === undefined ? 0.2 : opts.metal,
    roughness: opts.rough === undefined ? 0.6 : opts.rough,
    color: opts.color === undefined ? 0xffffff : opts.color,
    flatShading: !!opts.flat,
  });
  if (opts.normalMap) {
    mat.normalMap = opts.normalMap;
    mat.normalScale.set(opts.normalScale || 1, opts.normalScale || 1);
  }
  if (opts.roughMap) mat.roughnessMap = opts.roughMap;
  if (opts.emissive) {
    mat.emissive = new THREE.Color(opts.emissive);
    mat.emissiveIntensity = opts.emi === undefined ? 1.6 : opts.emi;
  }
  if (opts.transparent) {
    mat.transparent = true;
    mat.opacity = opts.opacity === undefined ? 0.6 : opts.opacity;
  }
  return mat;
}

/**
 * 一套单位用到的全部材质。
 * 角色名固定，模型代码只管「这块是装甲还是钢」。
 */
/**
 * 反照率补偿。
 *
 * 设计稿上的 #50582b 是「已经受光的最终颜色」——它本身就是一张画好的图。
 * 而在 PBR 里，这个颜色是 albedo，还要再乘光照、再经 ACES 曲线，
 * 结果就比设计稿暗一大截，读起来是"一团近黑"。
 *
 * 所以底色的正确做法是：把设计稿的最终色当成"受光后的目标"，
 * 反推出更亮的 albedo。1.5 是试出来的系数（见 tools/… 的测量）。
 */
const ALBEDO_BOOST = 1.52;

function boost(hex, k) {
  const c = new THREE.Color(hex);          // Color 会按 sRGB 解码到线性空间
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return c;
}

export function makeMaterials(envTex, pal) {
  const armorN = armorNormal();
  const metalR = metalRoughness();
  const A = (h) => boost(h, ALBEDO_BOOST);
  const K = ALBEDO_BOOST;

  const armor = injectWear(m(envTex, {
    color: A(pal.armor), metal: 0.22, rough: 0.55, env: 0.26,
    normalMap: armorN, normalScale: 0.7, roughMap: metalR,
  }), 0.052, 0.30);

  const armorDark = injectWear(m(envTex, {
    color: A(pal.armorDark), metal: 0.30, rough: 0.62, env: 0.22,
    normalMap: armorN, normalScale: 0.7,
  }), 0.058, 0.26);

  const armorLight = injectWear(m(envTex, {
    color: A(pal.armorLight), metal: 0.18, rough: 0.50, env: 0.30,
    normalMap: armorN, normalScale: 0.6, roughMap: metalR,
  }), 0.048, 0.24);

  const accent = injectWear(m(envTex, {
    color: A(pal.accent), metal: 0.26, rough: 0.52, env: 0.26,
    normalMap: armorN, normalScale: 0.65,
  }), 0.06, 0.26);

  const steel = m(envTex, {
    color: '#a9b3bd', metal: 0.95, rough: 0.28,
    normalMap: metalR, normalScale: 0.5,
  });
  const steelDark = m(envTex, {
    color: '#59636d', metal: 0.90, rough: 0.38, normalMap: metalR, normalScale: 0.5,
  });
  const steelLight = m(envTex, {
    color: '#cfd8e0', metal: 0.92, rough: 0.20,
  });
  const brass = m(envTex, {
    color: '#c39237', metal: 0.95, rough: 0.30,
  });
  const brassDark = m(envTex, {
    color: '#7d5a1f', metal: 0.90, rough: 0.42,
  });
  const rubber = m(envTex, {
    color: '#1d1f22', metal: 0.02, rough: 0.92,
  });
  const bore = m(envTex, {
    color: '#0a0c0e', metal: 0.4, rough: 0.85,
  });
  const glass = m(envTex, {
    color: pal.glass || '#8fe0f0', metal: 0.30, rough: 0.06,
    transparent: true, opacity: 0.62, env: 1.5,
  });
  const glow = m(envTex, {
    color: '#000000', emissive: pal.glow || '#8fe6b4',
    emi: 3.0, rough: 0.4,
  });
  const warn = m(envTex, {
    color: '#1a0f07', emissive: '#ff6a2a', emi: 3.2, rough: 0.5,
  });
  const red = m(envTex, {
    color: pal.red || '#b3261e', metal: 0.25, rough: 0.45,
  });

  return {
    armor, armorDark, armorLight, accent, steel, steelDark, steelLight,
    brass, brassDark, rubber, bore, glass, glow, warn, red,
  };
}

/* ================================================================ 后期 */

const QUAD_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uKnee;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float s = clamp((l - uThreshold) / max(uKnee, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(c * s, 1.0);
}`;

const BLUR_FRAG = `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;
void main(){
  /* 9 抽头高斯，权值 1/16,4/16,6/16,... 的近似 */
  vec3 sum = texture2D(tSrc, vUv).rgb * 0.227027;
  sum += texture2D(tSrc, vUv + uDir * 1.3846).rgb * 0.316216;
  sum += texture2D(tSrc, vUv - uDir * 1.3846).rgb * 0.316216;
  sum += texture2D(tSrc, vUv + uDir * 3.2307).rgb * 0.070270;
  sum += texture2D(tSrc, vUv - uDir * 3.2307).rgb * 0.070270;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMP_FRAG = `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform float uExposure;
uniform float uBloom;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uSat;

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 b = texture2D(tBloom1, vUv).rgb * 0.62 + texture2D(tBloom2, vUv).rgb * 0.85;

  c += b * uBloom;
  c *= uExposure;

  /* 冷暗部 / 暖高光：给画面一点色彩分离，纯灰的 PBR 会显得塑料 */
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(vec3(0.94, 0.97, 1.06), vec3(1.05, 1.01, 0.95), smoothstep(0.10, 1.2, lum));

  c = aces(c);

  /* 饱和度 */
  float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l2), c, uSat);

  /* 暗角 */
  /* 暗角只压最外圈：范围太宽会把整块场地都压暗，读起来像阴影 */
  float d = distance(vUv, vec2(0.5, 0.5)) * 1.12;
  c *= 1.0 - uVignette * smoothstep(0.62, 1.05, d);

  /* 极轻的颗粒，压掉渐变色带 */
  float g = fract(sin(dot(vUv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * uGrain;

  gl_FragColor = vec4(toSRGB(c), 1.0);
}`;

export class Post {
  constructor(renderer, w, h) {
    this.r = renderer;
    this.w = w; this.h = h;

    const rtOpt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, samples: CFG.msaa,
    });
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
    this.hw = hw; this.hh = hh; this.qw = qw; this.qh = qh;
    this.rtA = new THREE.WebGLRenderTarget(hw, hh, rtOpt);
    this.rtB = new THREE.WebGLRenderTarget(hw, hh, rtOpt);
    this.rtC = new THREE.WebGLRenderTarget(qw, qh, rtOpt);
    this.rtD = new THREE.WebGLRenderTarget(qw, qh, rtOpt);

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const S = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: frag, uniforms,
      depthTest: false, depthWrite: false,
    });

    this.mBright = S(BRIGHT_FRAG, {
      tSrc: { value: null }, uThreshold: { value: 1.18 }, uKnee: { value: 0.60 },
    });
    this.mBlur = S(BLUR_FRAG, {
      tSrc: { value: null }, uDir: { value: new THREE.Vector2() },
    });
    this.mComp = S(COMP_FRAG, {
      tScene: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
      uExposure: { value: 0.94 }, uBloom: { value: 0.80 },
      uVignette: { value: 0.22 }, uGrain: { value: 0.016 },
      uTime: { value: 0 }, uSat: { value: 1.10 },
    });
  }

  blit(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.quadScene, this.quadCam);
  }

  render(scene, camera, time) {
    const r = this.r;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    /* 记下这一帧场景的真实开销（后面的全屏合成会覆盖 info） */
    this.sceneStats = {
      calls: r.info.render.calls,
      tris: r.info.render.triangles,
    };

    if (!CFG.bloom) {
      this.mComp.uniforms.tScene.value = this.rtScene.texture;
      this.mComp.uniforms.tBloom1.value = this.rtScene.texture;
      this.mComp.uniforms.tBloom2.value = this.rtScene.texture;
      this.mComp.uniforms.uBloom.value = 0;
      this.mComp.uniforms.uTime.value = time;
      this.blit(this.mComp, null);
      return;
    }

    /* 亮部提取 → 半分辨率 → 两遍模糊 */
    this.mBright.uniforms.tSrc.value = this.rtScene.texture;
    this.blit(this.mBright, this.rtA);

    this.mBlur.uniforms.tSrc.value = this.rtA.texture;
    this.mBlur.uniforms.uDir.value.set(1 / this.hw, 0);
    this.blit(this.mBlur, this.rtB);

    this.mBlur.uniforms.tSrc.value = this.rtB.texture;
    this.mBlur.uniforms.uDir.value.set(0, 1 / this.hh);
    this.blit(this.mBlur, this.rtA);

    /* 再降一级，做大范围辉光 */
    this.mBright.uniforms.tSrc.value = this.rtA.texture;
    this.mBright.uniforms.uThreshold.value = 0.0;
    this.blit(this.mBright, this.rtC);
    this.mBright.uniforms.uThreshold.value = 1.18;

    this.mBlur.uniforms.tSrc.value = this.rtC.texture;
    this.mBlur.uniforms.uDir.value.set(1.6 / this.qw, 0);
    this.blit(this.mBlur, this.rtD);

    this.mBlur.uniforms.tSrc.value = this.rtD.texture;
    this.mBlur.uniforms.uDir.value.set(0, 1.6 / this.qh);
    this.blit(this.mBlur, this.rtC);

    /* 合成 */
    this.mComp.uniforms.tScene.value = this.rtScene.texture;
    this.mComp.uniforms.tBloom1.value = this.rtA.texture;
    this.mComp.uniforms.tBloom2.value = this.rtC.texture;
    this.mComp.uniforms.uTime.value = time;
    this.blit(this.mComp, null);
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtScene.setSize(w, h);
    this.hw = Math.max(2, w >> 1); this.hh = Math.max(2, h >> 1);
    this.qw = Math.max(2, w >> 2); this.qh = Math.max(2, h >> 2);
    this.rtA.setSize(this.hw, this.hh);
    this.rtB.setSize(this.hw, this.hh);
    this.rtC.setSize(this.qw, this.qh);
    this.rtD.setSize(this.qw, this.qh);
  }
}

/* ================================================================ 场景 */

/**
 * 建好渲染器 / 相机 / 灯光 / 环境。
 * 返回 { renderer, scene, camera, post, sun, envTex }
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, powerPreference: 'high-performance',
    stencil: false, depth: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(VIEW_W, VIEW_H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // 合成 pass 里手工做 sRGB
  renderer.toneMapping = THREE.NoToneMapping;               // 合成 pass 里手工做 ACES
  renderer.shadowMap.enabled = CFG.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();

  /* 环境贴图：金属观感的全部来源 */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const ec = new THREE.CanvasTexture(envCanvas());
  ec.mapping = THREE.EquirectangularReflectionMapping;
  ec.colorSpace = THREE.SRGBColorSpace;
  const envRT = pmrem.fromEquirectangular(ec);
  const envTex = envRT.texture;
  scene.environment = envTex;
  ec.dispose();

  /* ---- 相机：严格复刻游戏的伪 3D 投影 ---- */
  const tz = (VIEW_H / 2) / K;
  const camera = new THREE.OrthographicCamera(
    -VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 1, 9000);
  camera.position.set(VIEW_W / 2, 1800 * Math.sin(THETA), tz + 1800 * Math.cos(THETA));
  camera.lookAt(VIEW_W / 2, 0, tz);
  camera.updateProjectionMatrix();

  /* ---- 灯光：主光 + 天光 + 两侧轮廓光 ---- */
  const sun = new THREE.DirectionalLight(0xfff1d4, 4.70);
  sun.position.set(VIEW_W / 2 - 340, 620, tz + 320);
  sun.target.position.set(VIEW_W / 2, 0, tz);
  if (CFG.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 120;
    sun.shadow.camera.far = 3000;
    /* 必须覆盖整块场地：世界 Z 从 0 到 576/0.46 ≈ 1252，半程 626。
       之前 sy=520 只盖到 106..1146 —— 超出范围的像素会被判定为"在阴影里"，
       于是地图上下各出现一条横贯全屏的暗带。 */
    const sx = 780, sy = 720;
    sun.shadow.camera.left = -sx; sun.shadow.camera.right = sx;
    sun.shadow.camera.top = sy; sun.shadow.camera.bottom = -sy;
    sun.shadow.bias = -0.00055;
    sun.shadow.normalBias = 0.35;
  }
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0x9dc2ea, 0.40);
  fill.position.set(VIEW_W / 2 + 420, 260, tz - 260);
  scene.add(fill);

  /* 轮廓光：把深色单位从深色地面上剥离出来，"高级感"主要靠它 */
  const rim = new THREE.DirectionalLight(0xdff0ff, 0.95);
  rim.position.set(VIEW_W / 2 - 120, 300, tz - 620);
  scene.add(rim);

  const hemi = new THREE.HemisphereLight(0xa9c8dd, 0x2b2517, 0.30);
  scene.add(hemi);

  const post = new Post(renderer, VIEW_W, VIEW_H);

  return { renderer, scene, camera, post, sun, envTex, lights: { sun, fill, rim, hemi } };
}

export { glowSprite };
