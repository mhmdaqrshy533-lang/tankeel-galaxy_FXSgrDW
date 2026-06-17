import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

// --------------------------------------------------------
// CORE GUARD & PERSISTENT STORAGE
// --------------------------------------------------------
const LandscapeGuard = () => {
    const [warn, setWarn] = useState(window.innerHeight > window.innerWidth);
    useEffect(() => {
        const handle = () => setWarn(window.innerHeight > window.innerWidth);
        window.addEventListener('resize', handle);
        return () => window.removeEventListener('resize', handle);
    }, []);
    if (!warn) return null;
    return (
        <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col items-center justify-center p-8 text-center text-2xl font-bold font-mono">
            <div className="animate-pulse text-red-500 border-2 border-red-500 p-12 bg-red-900/20 shadow-[0_0_50px_rgba(255,0,0,0.5)] leading-relaxed">
                تحذير أمني: النظام مغلق تكتيكياً<br /><br />
                يرجى تدوير الشاشة للوضع الأفقي للتشغيل الحركي
            </div>
        </div>
    );
};

function useGameState<T>(key: string, initial: T) {
    const [val, setVal] = useState<T>(() => {
        try { const item = localStorage.getItem(key); return item ? JSON.parse(item) : initial; } 
        catch { return initial; }
    });
    const setLocal = (v: T | ((curr: T) => T)) => {
        try {
            const nv = v instanceof Function ? v(val) : v;
            setVal(nv); localStorage.setItem(key, JSON.stringify(nv));
        } catch {}
    };
    return [val, setLocal] as const;
}

// --------------------------------------------------------
// MATH & PROCEDURAL NOISE
// --------------------------------------------------------
let PRNG_SEED = 12345;
function random() {
    PRNG_SEED = (PRNG_SEED * 1664525 + 1013904223) % 4294967296;
    return PRNG_SEED / 4294967296;
}
const p = new Uint8Array(512);
for (let i = 0; i < 256; i++) { p[i] = Math.floor(random() * 256); p[i + 256] = p[i]; }
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t: number, a: number, b: number) { return a + t * (b - a); }
function grad(hash: number, x: number, y: number) {
    const h = hash & 3; let u = h < 2 ? x : y; let v = h < 2 ? y : x;
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
function fBm(x: number, z: number, oct = 4, f = 0.002) {
    let val = 0; let amp = 1;
    for (let i = 0; i < oct; i++) { val += noise2D(x * f, z * f) * amp; amp *= 0.5; f *= 2.0; }
    return val * 400;
}

// --------------------------------------------------------
// TACTICAL ENGINE
// --------------------------------------------------------
interface Target {
    mesh: THREE.Object3D;
    type: string;
    hp: number;
    active: boolean;
    vz?: number;
    vx?: number;
}

class TacticalEngine {
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    
    public rtTexture: THREE.WebGLRenderTarget;
    public postScene: THREE.Scene;
    public postCamera: THREE.OrthographicCamera;
    public postMaterial: THREE.ShaderMaterial;

    private clock = new THREE.Clock();
    private targets: Target[] = [];
    private explosions: { mesh: THREE.Points, vels: THREE.Vector3[], life: number }[] = [];
    
    private basePos = new THREE.Vector3(0, 0, 0);
    public inputL = { x: 0, y: 0 };
    private shakeTime = 0;
    private viewMode = 1; // 1 = FLIR

    public waterMesh?: THREE.Mesh;
    public onKill?: (g: number, d: number, s: number) => void;

    constructor(canvas: HTMLCanvasElement, envType: string) {
        const w = window.innerWidth; const h = window.innerHeight;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        
        this.camera = new THREE.PerspectiveCamera(45, w/h, 10, 20000);
        this.basePos.set(0, 0, 5000);

        const amb = new THREE.AmbientLight(0xffffff, 0.4);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(1000, 3000, 1000);
        this.scene.add(amb, dir);

        this.rtTexture = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter });
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.postScene = new THREE.Scene();
        this.postMaterial = new THREE.ShaderMaterial({
            uniforms: { tDiffuse: { value: this.rtTexture.texture }, uMode: { value: 1 }, time: { value: 0 } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                uniform sampler2D tDiffuse; uniform int uMode; uniform float time; varying vec2 vUv;
                void main() {
                    vec4 c = texture2D(tDiffuse, vUv);
                    if (uMode == 1) {
                        float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                        vec3 flir = mix(vec3(0.08, 0.09, 0.1), vec3(0.7, 0.75, 0.75), smoothstep(0.0, 0.7, luma));
                        if (c.r > 0.8 && c.g < 0.2 && c.b < 0.2) { flir = vec3(1.2) + sin(time*15.0)*0.1; }
                        flir += fract(sin(dot(vUv+time, vec2(12.9898,78.233))) * 43758.5453) * 0.05;
                        flir -= abs(sin(vUv.y * 600.0)) * 0.04;
                        gl_FragColor = vec4(flir, 1.0);
                    } else { gl_FragColor = c; }
                }`
        });
        this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

        this.buildEnv(envType);
        window.addEventListener('resize', this.onResize);
        this.renderer.setAnimationLoop(this.animate);
    }

    private buildEnv(env: string) {
        if (env === 'DESERT') {
            const tGeo = new THREE.PlaneGeometry(16000, 16000, 128, 128); tGeo.rotateX(-Math.PI / 2);
            const pos = tGeo.attributes.position; const colors = []; const c = new THREE.Color();
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i); const z = pos.getZ(i); const y = fBm(x, z);
                pos.setY(i, y);
                const rx = Math.sin(z * 0.0005) * 2000;
                if(Math.abs(x - rx) < 200) { c.setHex(0x3d2b1f); pos.setY(i, y * 0.3); } 
                else { if(y > 100) c.setHex(0x52463b); else c.setHex(0x735c43); }
                colors.push(c.r, c.g, c.b);
            }
            tGeo.computeVertexNormals(); tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            this.scene.add(new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true, roughness: 1.0 })));

            const geo = new THREE.BoxGeometry(20, 20, 40); geo.translate(0, 10, 0);
            for(let i=0; i<40; i++) {
                const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: 0xff0000}));
                this.scene.add(m);
                this.targets.push({ mesh: m, type: 'TRUCK', hp: 100, active: true, vz: 100 + Math.random()*50 });
            }
        } 
        else if (env === 'AIRBASE') {
            const f = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshLambertMaterial({color: 0x111111}));
            f.rotateX(-Math.PI/2); this.scene.add(f);
            this.scene.add(new THREE.GridHelper(20000, 150, 0x333333, 0x1a1a1a));

            const jet = new THREE.Group();
            const body = new THREE.Mesh(new THREE.ConeGeometry(5, 30, 4), new THREE.MeshBasicMaterial({color: 0xff0000})); body.rotateX(Math.PI/2);
            const wing = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), new THREE.MeshBasicMaterial({color: 0xff0000, side: 2})); wing.rotateX(-Math.PI/2);
            jet.add(body, wing);

            for(let i=0; i<30; i++) {
                const g = jet.clone();
                g.position.set((Math.random()-0.5)*12000, 5, (Math.random()-0.5)*12000);
                g.rotation.y = Math.random() * Math.PI;
                this.scene.add(g);
                this.targets.push({ mesh: g, type: 'JET', hp: 150, active: true });
            }
        } 
        else if (env === 'NAVAL') {
            const wGeo = new THREE.PlaneGeometry(20000, 20000, 128, 128); wGeo.rotateX(-Math.PI/2);
            this.waterMesh = new THREE.Mesh(wGeo, new THREE.MeshLambertMaterial({color: 0x051525}));
            this.scene.add(this.waterMesh);

            const ship = new THREE.Group();
            const hull = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 100).translate(0, 15, 0), new THREE.MeshBasicMaterial({color: 0xff0000}));
            const t = new THREE.Mesh(new THREE.BoxGeometry(16, 20, 30).translate(0, 40, 0), new THREE.MeshBasicMaterial({color: 0xff0000}));
            ship.add(hull, t);

            for(let i=0; i<20; i++) {
                const g = ship.clone();
                const ang = Math.random() * Math.PI * 2;
                g.position.set((Math.random()-0.5)*12000, 0, (Math.random()-0.5)*12000);
                g.rotation.y = Math.atan2(Math.sin(ang), Math.cos(ang));
                this.scene.add(g);
                this.targets.push({ mesh: g, type: 'SHIP', hp: 300, active: true, vx: Math.sin(ang)*40, vz: Math.cos(ang)*40 });
            }
        }
    }

    public setViewMode(m: number) { this.viewMode = m; }
    
    public fire(powerLvl: number) {
        this.shakeTime = 0.3;
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(0,0), this.camera);
        const objs = this.targets.map(t => t.mesh).flatMap(g => g.type === 'Group' ? g.children : g);
        const hits = rc.intersectObjects(objs, false);
        if (hits.length > 0) {
            let hitObj = hits[0].object;
            const target = this.targets.find(t => t.mesh === hitObj || t.mesh === hitObj.parent);
            if (target && target.active) {
                target.hp -= 30 * powerLvl;
                if (target.hp <= 0) {
                    target.active = false; target.mesh.visible = false;
                    this.spawnExp(target.mesh.position);
                    if(this.onKill) {
                        if(target.type==='TRUCK') this.onKill(100, 2, 10);
                        if(target.type==='JET') this.onKill(200, 5, 25);
                        if(target.type==='SHIP') this.onKill(500, 15, 50);
                    }
                }
            }
        }
    }

    private spawnExp(pos: THREE.Vector3) {
        const geo = new THREE.BufferGeometry();
        const pts = new Float32Array(300); const vels = [];
        for(let i=0; i<300; i+=3) {
            pts[i]=pos.x; pts[i+1]=pos.y; pts[i+2]=pos.z;
            vels.push(new THREE.Vector3((Math.random()-0.5)*2, Math.random(), (Math.random()-0.5)*2).normalize().multiplyScalar(400 + Math.random()*200));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const exp = new THREE.Points(geo, new THREE.PointsMaterial({color: 0xffaa00, size: 40, transparent: true}));
        this.scene.add(exp);
        this.explosions.push({ mesh: exp, vels, life: 1.0 });
    }

    private animate = () => {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const t = this.clock.getElapsedTime();

        for (let e of this.targets) {
            if (!e.active) continue;
            if (e.type === 'TRUCK' && e.vz) {
                e.mesh.position.z += e.vz * dt;
                if(e.mesh.position.z > 8000) e.mesh.position.z = -8000;
                const rx = Math.sin(e.mesh.position.z * 0.0005) * 2000;
                e.mesh.position.x = rx; e.mesh.position.y = fBm(rx, e.mesh.position.z) * 0.3;
                e.mesh.lookAt(Math.sin((e.mesh.position.z+10)*0.0005)*2000, e.mesh.position.y, e.mesh.position.z+10);
            }
            if (e.type === 'SHIP' && e.vx && e.vz) {
                e.mesh.position.addScaledVector(new THREE.Vector3(e.vx, 0, e.vz), dt);
                if(Math.abs(e.mesh.position.x)>8000) e.vx *= -1;
                if(Math.abs(e.mesh.position.z)>8000) e.vz *= -1;
                e.mesh.rotation.y = Math.atan2(e.vx, e.vz);
            }
        }

        for (let i = this.explosions.length - 1; i >= 0; i--) {
            let ex = this.explosions[i]; ex.life -= dt;
            const p = ex.mesh.geometry.attributes.position.array as Float32Array;
            for(let j=0; j<ex.vels.length; j++) {
                p[j*3] += ex.vels[j].x * dt; p[j*3+1] += ex.vels[j].y * dt; p[j*3+2] += ex.vels[j].z * dt;
            }
            ex.mesh.geometry.attributes.position.needsUpdate = true;
            (ex.mesh.material as THREE.PointsMaterial).opacity = ex.life;
            if(ex.life <= 0) { this.scene.remove(ex.mesh); this.explosions.splice(i, 1); }
        }

        if (this.waterMesh) {
            const pos = this.waterMesh.geometry.attributes.position as THREE.BufferAttribute;
            const arr = pos.array as Float32Array;
            for(let i=0; i<pos.count; i++) {
                arr[i*3+1] = Math.sin(arr[i*3]*0.01 + t*2)*15 + Math.cos(arr[i*3+2]*0.01 + t*2)*15;
            }
            pos.needsUpdate = true;
        }

        this.basePos.x += this.inputL.x * 3000 * dt;
        this.basePos.z += this.inputL.y * 3000 * dt; // pulling bottom (-y) translates to forward z (+z visually if neg lookat)

        this.camera.position.set(this.basePos.x, 2500, this.basePos.z);
        if (this.shakeTime > 0) {
            this.shakeTime -= dt;
            this.camera.position.x += (Math.random()-0.5)*100;
            this.camera.position.z += (Math.random()-0.5)*100;
        }
        this.camera.lookAt(this.basePos.x, 0, this.basePos.z - 1000);

        this.renderer.setRenderTarget(this.rtTexture);
        this.renderer.clear(); this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.postMaterial.uniforms.time.value = t;
        this.postMaterial.uniforms.uMode.value = this.viewMode;
        this.renderer.render(this.postScene, this.postCamera);
    };

    private onResize = () => {
        const w = window.innerWidth; const h = window.innerHeight;
        this.renderer.setSize(w, h); this.rtTexture.setSize(w, h);
        this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
    };

    public dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose(); this.rtTexture.dispose();
    }
}

// --------------------------------------------------------
// REACT UI COMPONENTS
// --------------------------------------------------------
const Joystick = ({ onMove }: { onMove: (x: number, y: number) => void }) => {
    const baseRef = useRef<HTMLDivElement>(null); const stickRef = useRef<HTMLDivElement>(null);
    const hMove = (e: React.PointerEvent) => {
        if (e.buttons === 0 || !baseRef.current || !stickRef.current) return;
        const rect = baseRef.current.getBoundingClientRect();
        let dx = e.clientX - (rect.left + rect.width/2); let dy = e.clientY - (rect.top + rect.height/2);
        const r = rect.width/2; const d = Math.min(Math.hypot(dx, dy), r); const a = Math.atan2(dy, dx);
        dx = Math.cos(a)*d; dy = Math.sin(a)*d;
        stickRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx/r, dy/r); // up is negative y
    };
    const hUp = () => { if(stickRef.current) stickRef.current.style.transform = `translate(0, 0)`; onMove(0,0); };
    return (
        <div ref={baseRef} className="w-32 h-32 rounded-full border-2 border-white/20 bg-black/40 backdrop-blur-sm touch-none flex items-center justify-center pointer-events-auto"
            onPointerDown={hMove} onPointerMove={hMove} onPointerUp={hUp} onPointerLeave={hUp}>
            <div ref={stickRef} className="w-12 h-12 rounded-full bg-white/60 shadow-[0_0_15px_#fff] pointer-events-none transition-transform duration-75" />
        </div>
    );
};

export default function App() {
    const [mode, setMode] = useState<'HANGAR' | 'MAP' | 'GAME'>('HANGAR');
    const [env, setEnv] = useState<'DESERT' | 'AIRBASE' | 'NAVAL'>('DESERT');
    
    const [res, setRes] = useGameState('RES', { gold: 5000, diamonds: 50, scrap: 100 });
    const [upg, setUpg] = useGameState('UPG', { armor: 1, power: 1, velocity: 1, reload: 1 });
    
    const [viewMode, setViewMode] = useState(1);
    const [zoomIdx, setZoomIdx] = useState(0);
    const zooms = [45, 30, 15]; const zoomStrs = ['x1.0', 'x2.5', 'x4.8'];
    const [lastFire, setLastFire] = useState(0);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);

    const buy = (stat: keyof typeof upg) => {
        const cost = upg[stat] * 1000;
        if(res.gold >= cost && upg[stat] < 5) {
            setRes({ ...res, gold: res.gold - cost });
            setUpg({ ...upg, [stat]: upg[stat] + 1 });
        }
    };

    const handleFire = () => {
        const now = Date.now(); const cd = 2000 - (upg.reload * 300);
        if (now - lastFire > cd && engineRef.current) {
            setLastFire(now);
            engineRef.current.fire(upg.power);
        }
    };

    useEffect(() => {
        if (mode === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalEngine(canvasRef.current, env);
            engineRef.current.onKill = (g, d, s) => setRes(r => ({ gold: r.gold+g, diamonds: r.diamonds+d, scrap: r.scrap+s }));
            engineRef.current.setViewMode(viewMode);
            engineRef.current.camera.fov = zooms[zoomIdx];
            engineRef.current.camera.updateProjectionMatrix();
        }
        return () => { if (mode !== 'GAME' && engineRef.current) { engineRef.current.dispose(); engineRef.current = null; } };
    }, [mode, env]);

    useEffect(() => { if(engineRef.current) engineRef.current.setViewMode(viewMode); }, [viewMode]);
    useEffect(() => { if(engineRef.current) { engineRef.current.camera.fov = zooms[zoomIdx]; engineRef.current.camera.updateProjectionMatrix(); } }, [zoomIdx]);

    return (
        <div className="w-screen h-screen bg-black overflow-hidden font-mono select-none" dir="rtl" style={{touchAction: 'none'}}>
            <LandscapeGuard />

            {mode === 'HANGAR' && (
                <div className="absolute inset-0 bg-zinc-900 border-[12px] border-black flex flex-col items-center pt-8 z-10">
                    <h1 className="text-4xl text-white font-black mb-8 tracking-widest shadow-black drop-shadow-md">مستودع الترقيات العسكرية</h1>
                    <div className="flex gap-6 mb-12">
                        {[ {id:'armor', t:'درع المسيرة'}, {id:'power', t:'طاقة القذيفة'}, {id:'velocity', t:'سرعة الصاروخ'}, {id:'reload', t:'معدل التلقيم'} ].map(u => (
                            <div key={u.id} className="bg-black/50 border border-white/20 p-4 w-56 flex flex-col items-center shadow-[0_0_15px_rgba(255,255,255,0.05)]">
                                <h3 className="text-white font-bold mb-3 tracking-widest">{u.t}</h3>
                                <div className="flex gap-1 mb-4 w-full justify-center">
                                    {[1,2,3,4,5].map(i => <div key={i} className={`h-2 flex-1 ${i <= upg[u.id as keyof typeof upg] ? 'bg-green-500 shadow-[0_0_8px_#0f0]' : 'bg-gray-800'}`} />)}
                                </div>
                                <button onClick={() => buy(u.id as any)} disabled={upg[u.id as keyof typeof upg] >= 5} className="w-full bg-white text-black font-bold py-2 disabled:opacity-50 hover:bg-gray-300 transition-colors">
                                    {upg[u.id as keyof typeof upg] >= 5 ? 'طاقة قصوى' : `ترقية (${upg[u.id as keyof typeof upg] * 1000} ذهب)`}
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-8 text-xl font-bold bg-black/80 px-8 py-4 border border-white/10 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
                        <div className="text-yellow-400 drop-shadow-md">الاعتمادات الذهبية: {res.gold}</div>
                        <div className="text-blue-400 drop-shadow-md">الماس التكتيكي: {res.diamonds}</div>
                        <div className="text-gray-400 drop-shadow-md">القطع التقنية: {res.scrap}</div>
                    </div>
                    <button onClick={() => setMode('MAP')} className="mt-8 bg-red-700 text-white font-black text-2xl px-16 py-5 hover:bg-red-500 transition-colors border-2 border-red-400 shadow-[0_0_20px_rgba(255,0,0,0.5)]">
                        خريطة العمليات التكتيكية
                    </button>
                </div>
            )}

            {mode === 'MAP' && (
                <div className="absolute inset-0 bg-black flex items-center justify-center">
                    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
                        <path d="M 0,200 Q 400,0 800,400 T 2000,200" stroke="#f00" strokeWidth="6" fill="none" strokeDasharray="10 20" />
                        <path d="M 0,600 Q 600,800 1000,300 T 2000,700" stroke="#00f" strokeWidth="6" fill="none" strokeDasharray="10 20" />
                    </svg>
                    <div className="absolute top-8 text-3xl font-black text-white bg-black/80 px-8 py-4 border border-white/20 tracking-widest shadow-[0_0_20px_rgba(255,255,255,0.2)]">خريطة العمليات الخاصة</div>
                    
                    {[ {e:'DESERT', t:'قافلة الصحراء', x:'30%', y:'40%', c:'border-orange-500', s:'shadow-[0_0_30px_#f97316]'},
                       {e:'AIRBASE', t:'المدرج الجوي', x:'55%', y:'65%', c:'border-blue-500', s:'shadow-[0_0_30px_#3b82f6]'},
                       {e:'NAVAL', t:'القطاع البحري', x:'80%', y:'35%', c:'border-teal-500', s:'shadow-[0_0_30px_#14b8a6]'} ].map(n => (
                           <div key={n.e} className="absolute flex flex-col items-center" style={{ left: n.x, top: n.y, transform: 'translate(-50%, -50%)' }}>
                               <button onClick={() => { setEnv(n.e as any); setMode('GAME'); }} className={`w-16 h-16 rounded-full bg-black border-4 ${n.c} ${n.s} flex items-center justify-center hover:scale-110 transition-transform`}>
                                   <div className="w-6 h-6 bg-white rounded-full animate-pulse" />
                               </button>
                               <span className="mt-4 bg-black/80 text-white px-4 py-1 border border-white/20 font-bold tracking-widest whitespace-nowrap">{n.t}</span>
                           </div>
                    ))}
                    <button onClick={() => setMode('HANGAR')} className="absolute bottom-8 right-8 bg-gray-800 border border-white/50 text-white font-bold px-8 py-3 hover:bg-gray-700 transition-colors">تراجع للمستودع</button>
                    
                    <div className="absolute bottom-6 left-8 flex flex-col gap-2 font-bold bg-black/80 p-4 border border-white/10">
                        <div className="text-yellow-400">ذهب: {res.gold}</div>
                        <div className="text-blue-400">ماس: {res.diamonds}</div>
                    </div>
                </div>
            )}

            {mode === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block touch-none" />
                    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
                        
                        {/* HUD TOP */}
                        <div className="flex justify-between items-start">
                            <div className="flex gap-4 font-bold">
                                <div className="bg-black/60 border border-yellow-500/50 p-2 px-4 shadow-[0_0_10px_rgba(255,215,0,0.2)]">
                                    الميزانية: <span className="text-yellow-400">{res.gold}</span>
                                </div>
                                <div className="bg-black/60 border border-white/30 p-2 px-4 shadow-[0_0_10px_rgba(255,255,255,0.1)] text-white/80">
                                    القطاع: {env}
                                </div>
                            </div>
                            <div className="flex gap-4 pointer-events-auto">
                                <button onClick={() => setViewMode(1 - viewMode)} className={`border-2 p-3 px-6 font-bold text-sm tracking-widest transition-colors ${viewMode === 1 ? 'border-green-500 bg-green-900/40 text-green-400' : 'border-blue-500 bg-blue-900/40 text-blue-400'}`}>
                                    {viewMode === 1 ? 'FLIR: ACTIVE' : 'OPTICS: COLOR'}
                                </button>
                                <button onClick={() => setMode('MAP')} className="bg-red-800/80 border border-red-500 text-white font-bold px-4 hover:bg-red-600">إلغاء المهمة</button>
                            </div>
                        </div>

                        {/* CENTER CROSSHAIR */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-64 h-64 relative text-white/80">
                                <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-white/80" />
                                <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-white/80" />
                                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-white/80" />
                                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-white/80" />
                                
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-56 h-[1px] bg-white/20" />
                                <div className="absolute top-1/2 left-1/2 -translate-y-1/2 w-[1px] h-56 bg-white/20" />
                                <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-red-500 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_15px_#f00]" />

                                <button onPointerDown={(e) => { e.stopPropagation(); setZoomIdx((zoomIdx+1)%3); }} className="absolute -left-20 bottom-0 pointer-events-auto bg-black/80 border border-white/30 px-3 py-1 text-lg font-bold hover:bg-white hover:text-black">
                                    {zoomStrs[zoomIdx]}
                                </button>
                            </div>
                            
                            <div className="absolute right-24 h-96 w-16 border-r-2 border-white/30 flex flex-col justify-between items-end pr-3 text-sm text-white/50">
                                {[80,60,40,20,0,-20,-40,-60,-80].map(v => (
                                    <div key={v} className="flex items-center gap-2">
                                        <span className={v===0 ? 'text-white font-bold' : ''}>{v > 0 ? '+'+v : v}</span>
                                        <div className={`h-[2px] bg-white/30 ${v===0 ? 'w-6 bg-white' : 'w-3'}`} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* HUD BOTTOM */}
                        <div className="flex justify-between items-end">
                            <Joystick onMove={(x, y) => { if(engineRef.current) { engineRef.current.inputL.x = x; engineRef.current.inputL.y = y; } }} />
                            
                            <div className="flex items-end gap-6 pointer-events-auto pr-8 pb-4">
                                <div className="bg-black/80 border border-white/20 p-4 pb-2 w-36 flex flex-col items-center">
                                    <div className="w-full h-16 border border-white/50 mb-2 relative flex items-center justify-center">
                                        <div className="absolute inset-0 bg-red-600/20" />
                                        <div className="w-10 h-2 bg-white rounded-full relative">
                                            <div className="absolute -left-1 -top-1 border-t-[3px] border-r-[3px] border-white w-3 h-3 rotate-45" />
                                        </div>
                                    </div>
                                    <span className="text-xs text-white/80 font-bold tracking-widest mb-1">صاروخ موجه</span>
                                    <div className="w-full h-1 bg-green-500 shadow-[0_0_10px_#0f0]" />
                                </div>
                                <button onPointerDown={(e) => { e.stopPropagation(); handleFire(); }} className="w-32 h-32 rounded-full bg-red-700/90 border-[6px] border-black shadow-[0_0_0_4px_#ef4444,0_0_40px_rgba(239,68,68,0.8)] outline-none active:bg-red-500 active:scale-95 transition-transform text-white font-black text-2xl flex items-center justify-center hover:bg-red-600">
                                    FIRE
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
