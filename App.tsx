import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

// --------------------------------------------------------
// CORE SYSTEM GATEWAY
// --------------------------------------------------------
const CORE_KEY = "SGRD-99X-HAZBARI";

// --------------------------------------------------------
// MATH & 4-OCTAVE FBM PROCEDURAL NOISE
// --------------------------------------------------------
const p = new Uint8Array(512);
for (let i = 0; i < 256; i++) {
  p[i] = Math.floor(Math.random() * 256);
  p[i + 256] = p[i];
}
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t: number, a: number, b: number) { return a + t * (b - a); }
function grad(hash: number, x: number, y: number) {
  const h = hash & 3; 
  let u = h < 2 ? x : y; 
  let v = h < 2 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
}
function noise2D(x: number, y: number) {
  let X = Math.floor(x) & 255; let Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  let u = fade(x); let v = fade(y);
  let A = p[X] + Y, B = p[X + 1] + Y;
  return lerp(v, lerp(u, grad(p[A], x, y), grad(p[B], x - 1, y)),
                 lerp(u, grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1)));
}
function fBm(x: number, z: number) {
  let val = 0; let amp = 1; let freq = 0.002;
  for (let i = 0; i < 4; i++) {
    val += noise2D(x * freq, z * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return val * 400; 
}

// --------------------------------------------------------
// HYBRID TACTICAL RENDERING ENGINE
// --------------------------------------------------------
class TacticalEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  
  private droneCamera: THREE.PerspectiveCamera;
  private fpsCamera: THREE.PerspectiveCamera;
  
  private gunScene: THREE.Scene;
  private gunCamera: THREE.PerspectiveCamera;
  private gunMesh: THREE.Group;
  
  private rtTexture: THREE.WebGLRenderTarget;
  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postMaterial: THREE.ShaderMaterial;
  
  private terrain!: THREE.Mesh;
  private enemies: { mesh: THREE.Mesh, hp: number, active: boolean }[] = [];
  private bullets: { mesh: THREE.Mesh, vel: THREE.Vector3, life: number }[] = [];
  
  public state = {
      view: 'DRONE' as 'DRONE' | 'GROUND_FPS',
      dronePos: new THREE.Vector3(0, 3000, 0),
      fpsPos: new THREE.Vector3(0, 0, 0),
      fpsYaw: 0, fpsPitch: 0,
      inputL: {x: 0, y: 0},
      inputR: {x: 0, y: 0},
      health: 100, ammo: 120,
      recoil: 0
  };
  
  private clock = new THREE.Clock();
  public onHudUpdate: (data: any) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const w = window.innerWidth; const h = window.innerHeight;
    
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020202);
    this.scene.fog = new THREE.FogExp2(0x020202, 0.0002);
    
    this.droneCamera = new THREE.PerspectiveCamera(30, w/h, 10, 15000);
    this.fpsCamera = new THREE.PerspectiveCamera(70, w/h, 0.1, 5000);
    
    this.gunScene = new THREE.Scene();
    this.gunCamera = new THREE.PerspectiveCamera(70, w/h, 0.01, 100);
    this.gunMesh = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), new THREE.MeshBasicMaterial({color: 0x333333}));
    barrel.position.set(0.2, -0.2, -0.5);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2), new THREE.MeshBasicMaterial({color: 0x111111}));
    scope.rotation.x = Math.PI / 2; scope.position.set(0.2, -0.1, -0.4);
    this.gunMesh.add(barrel, scope);
    this.gunScene.add(this.gunMesh);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(100, 200, 50);
    this.scene.add(ambientLight, dirLight);
    
    // CUSTOM MONOCHROME FLIR SHADER
    this.rtTexture = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter });
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene = new THREE.Scene();
    this.postMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: this.rtTexture.texture }, time: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
            void main() {
                vec4 c = texture2D(tDiffuse, vUv);
                float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                vec3 final = mix(vec3(0.05, 0.06, 0.08), vec3(0.4, 0.45, 0.45), smoothstep(0.0, 0.6, luma));
                if (c.r > 0.8 && c.g > 0.8 && c.b > 0.8) { final = vec3(1.0); } 
                final -= sin(vUv.y * 1000.0) * 0.05; 
                final += fract(sin(dot(vUv + time, vec2(12.9898,78.233))) * 43758.5453) * 0.08; 
                gl_FragColor = vec4(final, 1.0);
            }
        `
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));
    
    this.createWorld();
    
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(this.animate);
  }
  
  private createWorld() {
      const tGeo = new THREE.PlaneGeometry(15000, 15000, 256, 256);
      tGeo.rotateX(-Math.PI / 2);
      const pos = tGeo.attributes.position;
      const colors = []; const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i); const z = pos.getZ(i);
          const y = fBm(x, z);
          pos.setY(i, y);
          if (y > 100) c.setHex(0x444444);
          else if (y > 0) c.setHex(0x333333);
          else c.setHex(0x1a1a1a);
          colors.push(c.r, c.g, c.b);
      }
      tGeo.computeVertexNormals();
      tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this.terrain = new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true, roughness: 1.0 }));
      this.scene.add(this.terrain);
      
      const eGeo = new THREE.BoxGeometry(10, 8, 12);
      eGeo.translate(0, 4, 0);
      const eMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (let i = 0; i < 150; i++) {
          const x = (Math.random() - 0.5) * 12000; const z = (Math.random() - 0.5) * 12000;
          const y = fBm(x, z);
          const mesh = new THREE.Mesh(eGeo, eMat);
          mesh.position.set(x, y, z);
          mesh.rotation.y = Math.random() * Math.PI;
          this.scene.add(mesh);
          this.enemies.push({ mesh, hp: 100, active: true });
      }

      this.state.fpsPos.set(0, fBm(0, 0), 0);
  }
  
  public toggleView() {
      this.state.view = this.state.view === 'DRONE' ? 'GROUND_FPS' : 'DRONE';
      if (this.state.view === 'GROUND_FPS') {
          this.state.fpsPos.x = this.state.dronePos.x;
          this.state.fpsPos.z = this.state.dronePos.z;
          this.state.fpsPos.y = fBm(this.state.fpsPos.x, this.state.fpsPos.z);
      } else {
          this.state.dronePos.x = this.state.fpsPos.x;
          this.state.dronePos.z = this.state.fpsPos.z;
      }
      this.onHudUpdate({ view: this.state.view });
  }

  public fire() {
      if (this.state.view === 'GROUND_FPS') {
          if (this.state.ammo <= 0) return;
          this.state.ammo--; this.state.recoil = 0.15;
          this.onHudUpdate({ ammo: this.state.ammo });
          
          const rc = new THREE.Raycaster();
          rc.setFromCamera(new THREE.Vector2(0,0), this.fpsCamera);
          
          for (let e of this.enemies) {
              if (e.active && rc.ray.distanceSqToPoint(e.mesh.position) < 200) {
                  e.hp -= 34;
                  if (e.hp <= 0) { e.active = false; e.mesh.visible = false; }
              }
          }
      } else {
          const bGeo = new THREE.CylinderGeometry(1, 1, 10); bGeo.rotateX(Math.PI/2);
          const b = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({color: 0xffffff}));
          b.position.copy(this.droneCamera.position); b.position.y -= 10;
          const rc = new THREE.Raycaster();
          rc.setFromCamera(new THREE.Vector2(0,0), this.droneCamera);
          this.bullets.push({ mesh: b, vel: rc.ray.direction.multiplyScalar(2000), life: 2.0 });
          this.scene.add(b);
      }
  }

  public airstrike() {
      if (this.state.view !== 'GROUND_FPS') return;
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(0,0), this.fpsCamera);
      const target = rc.ray.at(1000, new THREE.Vector3());
      
      const bGeo = new THREE.CylinderGeometry(5, 5, 20); bGeo.rotateX(Math.PI/2);
      const b = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({color: 0xffffff}));
      b.position.set(target.x, target.y + 2000, target.z);
      
      this.bullets.push({ mesh: b, vel: new THREE.Vector3(0, -3000, 0), life: 2.0 });
      this.scene.add(b);
  }
  
  private animate = () => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const time = this.clock.getElapsedTime();
      
      if (this.state.view === 'DRONE') {
          const speed = 1000 * dt;
          this.state.dronePos.x += this.state.inputL.x * speed;
          this.state.dronePos.z += this.state.inputL.y * speed;
          
          this.droneCamera.position.copy(this.state.dronePos);
          this.droneCamera.position.x += this.state.inputR.x * 500;
          this.droneCamera.position.z += this.state.inputR.y * 500;
          this.droneCamera.lookAt(this.state.dronePos.x, 0, this.state.dronePos.z);

          let nearest = null; let minDist = 0.2;
          for (let e of this.enemies) {
              if (!e.active) continue;
              const p = e.mesh.position.clone().project(this.droneCamera);
              if (p.z > 1) continue;
              const d = Math.hypot(p.x, p.y);
              if (d < minDist) { minDist = d; nearest = p; }
          }
          const bracket = document.getElementById('target-bracket');
          if (bracket) {
              if (nearest) {
                  bracket.style.display = 'block';
                  bracket.style.transform = `translate(${(nearest.x * 0.5 + 0.5)*window.innerWidth}px, ${(-(nearest.y * 0.5) + 0.5)*window.innerHeight}px)`;
              } else {
                  bracket.style.display = 'none';
              }
          }
          
      } else {
          const moveSpeed = 60 * dt;
          const rotSpeed = 2.0 * dt;
          this.state.fpsYaw -= this.state.inputR.x * rotSpeed;
          this.state.fpsPitch += this.state.inputR.y * rotSpeed;
          this.state.fpsPitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.state.fpsPitch));
          
          const fwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), this.state.fpsYaw);
          const right = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), this.state.fpsYaw);
          
          this.state.fpsPos.add(fwd.multiplyScalar(-this.state.inputL.y * moveSpeed));
          this.state.fpsPos.add(right.multiplyScalar(this.state.inputL.x * moveSpeed));
          
          const gy = fBm(this.state.fpsPos.x, this.state.fpsPos.z);
          this.state.fpsPos.y = THREE.MathUtils.lerp(this.state.fpsPos.y, gy + 1.8, dt * 10);
          
          this.fpsCamera.position.copy(this.state.fpsPos);
          this.fpsCamera.rotation.set(this.state.fpsPitch, this.state.fpsYaw, 0, 'YXZ');
          
          const swayX = Math.sin(time * 5) * 0.02 * (Math.abs(this.state.inputL.x) + Math.abs(this.state.inputL.y));
          const swayY = Math.cos(time * 10) * 0.02 * (Math.abs(this.state.inputL.x) + Math.abs(this.state.inputL.y));
          this.gunMesh.position.set(0.2 + swayX, -0.2 + swayY, -0.5 + this.state.recoil);
          if (this.state.recoil > 0) this.state.recoil = Math.max(0, this.state.recoil - dt * 2.0);

          for (let e of this.enemies) {
              if (e.active && e.mesh.position.distanceTo(this.fpsCamera.position) < 300) {
                  if (Math.random() < 0.005) {
                      this.state.health -= 5;
                      this.onHudUpdate({ health: Math.max(0, this.state.health) });
                  }
              }
          }
      }

      for (let i = this.bullets.length - 1; i >= 0; i--) {
          const b = this.bullets[i];
          b.life -= dt;
          b.mesh.position.addScaledVector(b.vel, dt);
          if (b.life <= 0 || b.mesh.position.y < fBm(b.mesh.position.x, b.mesh.position.z)) {
              for (let e of this.enemies) {
                  if (e.active && e.mesh.position.distanceTo(b.mesh.position) < 200) {
                      e.hp -= 100; if (e.hp <= 0) { e.active = false; e.mesh.visible = false; }
                  }
              }
              this.scene.remove(b.mesh);
              this.bullets.splice(i, 1);
          }
      }

      if (this.state.view === 'DRONE') {
          this.renderer.setRenderTarget(this.rtTexture);
          this.renderer.clear();
          this.renderer.render(this.scene, this.droneCamera);
          
          this.renderer.setRenderTarget(null);
          this.postMaterial.uniforms.time.value = time;
          this.renderer.render(this.postScene, this.postCamera);
      } else {
          this.renderer.clear();
          this.renderer.render(this.scene, this.fpsCamera);
          
          this.renderer.clearDepth();
          this.renderer.render(this.gunScene, this.gunCamera);
      }
  };
  
  private onResize = () => {
      const w = window.innerWidth; const h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.rtTexture.setSize(w, h);
      this.droneCamera.aspect = w/h; this.droneCamera.updateProjectionMatrix();
      this.fpsCamera.aspect = w/h; this.fpsCamera.updateProjectionMatrix();
      this.gunCamera.aspect = w/h; this.gunCamera.updateProjectionMatrix();
  };
  
  public dispose() {
      window.removeEventListener('resize', this.onResize);
      this.renderer.dispose();
  }
}

// --------------------------------------------------------
// REACT UI COMPONENTS (ABSOLUTE OVERLAYS)
// --------------------------------------------------------

function Joystick({ onMove, side }: { onMove: (x: number, y: number) => void, side: 'left' | 'right' }) {
    const baseRef = useRef<HTMLDivElement>(null);
    const stickRef = useRef<HTMLDivElement>(null);

    const handlePointerMove = (e: React.PointerEvent) => {
        if (e.buttons === 0) return;
        if (!baseRef.current || !stickRef.current) return;
        const rect = baseRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
        let dx = e.clientX - cx; let dy = e.clientY - cy;
        const rad = rect.width / 2;
        const dist = Math.min(Math.hypot(dx, dy), rad);
        const angle = Math.atan2(dy, dx);
        dx = Math.cos(angle) * dist; dy = Math.sin(angle) * dist;
        
        stickRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx / rad, dy / rad);
    };

    const handlePointerUp = () => {
        if (stickRef.current) stickRef.current.style.transform = `translate(0px, 0px)`;
        onMove(0, 0);
    };

    return (
        <div ref={baseRef} 
             className={`absolute bottom-8 w-32 h-32 rounded-full border-2 border-white/20 bg-black/10 touch-none backdrop-blur-sm flex items-center justify-center pointer-events-auto z-40 ${side === 'left' ? 'left-8' : 'right-8'}`}
             onPointerDown={handlePointerMove} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}>
             <div ref={stickRef} className="w-12 h-12 rounded-full bg-white/40 shadow-[0_0_15px_rgba(255,255,255,0.5)] pointer-events-none transition-transform duration-75" />
        </div>
    );
}

export default function App() {
    const [appState, setAppState] = useState<'AUTH' | 'MENU' | 'TRANSITION' | 'GAME'>('AUTH');
    const [code, setCode] = useState("");
    const [error, setError] = useState(false);
    
    const [hudData, setHudData] = useState({ view: 'DRONE', health: 100, ammo: 120 });
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);

    const checkCode = (e: React.FormEvent) => {
        e.preventDefault();
        if (code === CORE_KEY) {
            setAppState('TRANSITION');
            setTimeout(() => setAppState('MENU'), 1500);
        } else {
            setError(true);
            setTimeout(() => setError(false), 1000);
        }
    };

    useEffect(() => {
        if (appState === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalEngine(canvasRef.current);
            engineRef.current.onHudUpdate = (data) => setHudData(prev => ({...prev, ...data}));
        }
        return () => {
            if (appState !== 'GAME' && engineRef.current) {
                engineRef.current.dispose();
                engineRef.current = null;
            }
        };
    }, [appState]);

    const handleInputL = useCallback((x: number, y: number) => {
        if (engineRef.current) { engineRef.current.state.inputL = { x, y }; }
    }, []);
    const handleInputR = useCallback((x: number, y: number) => {
        if (engineRef.current) { engineRef.current.state.inputR = { x, y }; }
    }, []);

    return (
        <div className="w-screen h-screen bg-black overflow-hidden font-mono select-none" dir="rtl">
            {appState === 'AUTH' && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
                    <div className="w-96 p-8 border border-white/20 bg-black/80 backdrop-blur-md">
                        <h1 className="text-2xl font-bold text-white mb-6 text-center">منصة التشفير السيادي</h1>
                        <form onSubmit={checkCode} className="flex flex-col gap-4">
                            <input 
                                type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                                placeholder="ACCESS CODE" dir="ltr"
                                className={`w-full bg-transparent border-b-2 ${error ? 'border-red-500 text-red-500' : 'border-white text-white'} p-2 text-center text-xl outline-none tracking-widest`}
                            />
                            <button type="submit" className="w-full bg-white text-black font-bold py-3 mt-4 hover:bg-gray-200">تحقق</button>
                        </form>
                    </div>
                </div>
            )}

            {appState === 'TRANSITION' && (
                <div className="absolute inset-0 bg-black flex items-center justify-center z-50">
                    <div className="w-full h-1 bg-white animate-pulse shadow-[0_0_20px_#fff]" />
                </div>
            )}

            {appState === 'MENU' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 border-[10px] border-black">
                    <h1 className="text-4xl text-white font-bold mb-10 tracking-widest">قاعدة العمليات الجوية</h1>
                    <div className="text-green-500 mb-8 font-bold animate-pulse">حالة الاستعداد القتالي: نشط</div>
                    <button onClick={() => setAppState('GAME')} className="w-64 bg-white text-black font-bold py-4 mb-4 hover:bg-gray-300">بدء المهمة التكتيكية</button>
                    <button className="w-64 border border-white/30 text-white/70 font-bold py-4 hover:bg-white/10">ربط سلاح الإشارة المحلي</button>
                </div>
            )}

            {appState === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
                    
                    <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-4">
                        <div className="flex justify-between items-start">
                            <div className="flex flex-col gap-2">
                                {hudData.view === 'GROUND_FPS' && (
                                    <>
                                        <div className="bg-black/60 border border-white/20 p-2 px-4 w-64 backdrop-blur-md">
                                            <div className="text-xs text-white/50 mb-1">مؤشر الصحة الحيوية</div>
                                            <div className="w-full h-2 bg-red-900/50">
                                                <div className="h-full bg-white transition-all" style={{width: `${Math.max(0, hudData.health)}%`}} />
                                            </div>
                                        </div>
                                        <div className="bg-black/60 border border-white/20 p-2 px-4 w-64 backdrop-blur-md">
                                            <div className="text-xs text-white/50 mb-1">مخزن الذخيرة الحالي</div>
                                            <div className="text-xl font-bold text-white text-left" dir="ltr">{hudData.ammo} / 120</div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {hudData.view === 'GROUND_FPS' && (
                                <div className="w-32 h-32 rounded-full border-2 border-white/20 bg-black/50 backdrop-blur-md relative overflow-hidden">
                                     <div className="absolute top-2 left-0 right-0 text-center text-[10px] text-white/60">رادار الخريطة المصغر</div>
                                     <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-white rounded-full shadow-[0_0_5px_#fff] -translate-x-1/2 -translate-y-1/2" />
                                     <div className="absolute top-1/2 left-1/2 w-full h-full border border-white/20 rounded-full animate-ping -translate-x-1/2 -translate-y-1/2" />
                                </div>
                            )}

                            {hudData.view === 'DRONE' && (
                                <div className="text-white text-xl font-bold tracking-widest bg-black/50 px-4 py-2" dir="ltr">
                                    FLIR OPTICS / HIGH VAL TGT
                                </div>
                            )}

                            <button onClick={() => engineRef.current?.toggleView()} className="pointer-events-auto bg-black/50 border border-white/30 text-white font-bold py-2 px-4 hover:bg-white hover:text-black transition-colors w-64">
                                تبديل المنظور والتكتيك
                            </button>
                        </div>

                        {hudData.view === 'DRONE' && (
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 border-2 border-white/30 flex items-center justify-center">
                                <div className="w-1 h-1 bg-white" />
                                <div className="absolute -top-4 w-0.5 h-4 bg-white/30" />
                                <div className="absolute -bottom-4 w-0.5 h-4 bg-white/30" />
                                <div className="absolute -left-4 w-4 h-0.5 bg-white/30" />
                                <div className="absolute -right-4 w-4 h-0.5 bg-white/30" />
                            </div>
                        )}

                        <div id="target-bracket" className="absolute top-0 left-0 w-12 h-12 border border-white/80 shadow-[0_0_10px_#fff] -translate-x-1/2 -translate-y-1/2 pointer-events-none hidden transition-transform duration-75">
                             <div className="absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2 border-white" />
                             <div className="absolute -bottom-1 -left-1 w-2 h-2 border-b-2 border-l-2 border-white" />
                        </div>

                        {hudData.view === 'GROUND_FPS' && (
                             <div className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-white/80 -translate-x-1/2 -translate-y-1/2" />
                        )}

                        <div className="flex justify-between items-end pb-8 px-4 h-1/2">
                            <Joystick side="left" onMove={handleInputL} />
                            
                            {hudData.view === 'GROUND_FPS' && (
                                <button onClick={() => engineRef.current?.airstrike()} onPointerDown={(e)=>e.stopPropagation()} className="pointer-events-auto mx-auto bg-black/80 text-white font-bold border border-white/50 px-8 py-4 uppercase tracking-widest shadow-[0_0_15px_rgba(255,255,255,0.4)] active:bg-white active:text-black">
                                    استدعاء الإسناد الجوي
                                </button>
                            )}

                            <Joystick side="right" onMove={handleInputR} />
                            
                            <button onPointerDown={(e) => { e.stopPropagation(); engineRef.current?.fire(); }} className="absolute right-32 bottom-32 pointer-events-auto rounded-full w-20 h-20 bg-white/10 border-2 border-white shadow-[0_0_20px_#fff] active:bg-white active:scale-95 transition-all outline-none flex items-center justify-center">
                                <div className="w-8 h-8 rounded-full bg-white" />
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
