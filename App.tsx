import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

// --- STYLING & CRT CONSTANTS ---
const C_BG = '#1A1C1E';
const C_PANEL = '#2C3034';
const C_TEXT = '#00FF66';
const C_BORDER = '#3F444A';

const scanlineStyles = {
    background: 'linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.2) 50%)',
    backgroundSize: '100% 4px',
    pointerEvents: 'none' as const,
};

// --- ICONS ---
const LockIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-red-500 opacity-80">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
);
const ChevronDown = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
);
const TargetIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-full h-full opacity-50">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="2" x2="12" y2="22"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
    </svg>
);

// --- PERSISTENT STATE ---
function useSaveData() {
    const [d, setD] = useState(() => {
        try {
            const v = localStorage.getItem('TAC_SIM_SAVE');
            return v ? JSON.parse(v) : { unlockedLevel: 1, credits: 0 };
        } catch { return { unlockedLevel: 1, credits: 0 }; }
    });
    useEffect(() => { localStorage.setItem('TAC_SIM_SAVE', JSON.stringify(d)); }, [d]);
    return [d, setD] as const;
}

// --- PROCEDURAL GENERATION ---
function terrainHeight(x: number, z: number) {
    return (Math.sin(x*0.003)*Math.cos(z*0.003)*200) + (Math.sin(x*0.01 + z*0.015)*40);
}

// --- ENGINE MODULE ---
interface TacticalTarget {
    mesh: THREE.Object3D;
    hp: number;
    maxHp: number;
    active: boolean;
    type: 'INFANTRY' | 'SHIP' | 'TRAIN';
    vx?: number; vz?: number;
}

class TacticalSim {
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    public cameraChase: THREE.PerspectiveCamera;
    public cameraFLIR: THREE.PerspectiveCamera;
    public cameraGround: THREE.PerspectiveCamera;
    public activeCamera: THREE.PerspectiveCamera;

    public drone: THREE.Group;
    public targets: TacticalTarget[] = [];
    public explosions: { mesh: THREE.Points, life: number, vels: THREE.Vector3[] }[] = [];
    public missiles: { mesh: THREE.Mesh, vel: THREE.Vector3, life: number }[] = [];

    public waterMesh?: THREE.Mesh;
    private clock = new THREE.Clock();
    public level: number;
    
    public input = { x: 0, y: 0 };
    public onVictory?: () => void;
    public onSync?: (data: any) => void;
    public isGroundMode = false;
    private shake = 0;

    constructor(canvas: HTMLCanvasElement, level: number) {
        const w = window.innerWidth; const h = window.innerHeight;
        this.level = level;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(level === 1 ? 0x87CEEB : (level===2 ? 0x05101a : 0x201510), 0.0003);
        this.scene.background = new THREE.Color(level === 1 ? 0x87CEEB : (level===2 ? 0x05101a : 0x201510));

        this.cameraChase = new THREE.PerspectiveCamera(60, w/h, 1, 20000);
        this.cameraFLIR = new THREE.PerspectiveCamera(30, w/h, 1, 20000);
        this.cameraGround = new THREE.PerspectiveCamera(70, w/h, 1, 20000);
        this.activeCamera = this.cameraFLIR;

        const amb = new THREE.AmbientLight(0xffffff, 0.4);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(500, 2000, 500);
        this.scene.add(amb, dir);

        // Drone Mesh (B2 / MQ9 hybrid)
        this.drone = new THREE.Group();
        const matMatte = new THREE.MeshStandardMaterial({color: 0x343A40, roughness: 0.9, metalness: 0.2});
        const dBody = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 12), matMatte);
        const dWing = new THREE.Mesh(new THREE.BufferGeometry(), matMatte);
        const wPts = new Float32Array([
            0,0,-4,  25,0,8,  0,0,4,   0,0,-4,  0,0,4,  -25,0,8
        ]);
        dWing.geometry.setAttribute('position', new THREE.BufferAttribute(wPts, 3));
        dWing.geometry.computeVertexNormals();
        this.drone.add(dBody, dWing);
        this.drone.position.set(0, 1500, 4000);
        this.scene.add(this.drone);

        this.buildLevel();
        window.addEventListener('resize', this.onResize);
        this.renderer.setAnimationLoop(this.animate);
    }

    private buildLevel() {
        if (this.level === 1) { // Mountain Infiltration
            const th = new THREE.PlaneGeometry(16000, 16000, 128, 128); th.rotateX(-Math.PI/2);
            const pos = th.attributes.position; const colors = []; const c = new THREE.Color();
            for(let i=0; i<pos.count; i++) {
                const x = pos.getX(i); const z = pos.getZ(i); const y = terrainHeight(x, z); pos.setY(i, y);
                if(y>100) c.setHex(0x5a4d41); else c.setHex(0x4a5d23);
                colors.push(c.r, c.g, c.b);
            }
            th.computeVertexNormals(); th.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            this.scene.add(new THREE.Mesh(th, new THREE.MeshLambertMaterial({vertexColors: true})));

            const eGeo = new THREE.CylinderGeometry(4, 4, 15); eGeo.translate(0, 7.5, 0);
            const eMat = new THREE.MeshLambertMaterial({color: 0x222222});
            for(let i=0; i<30; i++) {
                const e = new THREE.Mesh(eGeo, eMat);
                e.position.set((Math.random()-0.5)*4000, 0, 3000 - Math.random()*8000);
                e.position.y = terrainHeight(e.position.x, e.position.z);
                this.scene.add(e);
                this.targets.push({ mesh: e, hp: 50, maxHp: 50, active: true, type: 'INFANTRY' });
            }
        } 
        else if (this.level === 2) { // Naval
            const wGeo = new THREE.PlaneGeometry(20000, 20000, 128, 128); wGeo.rotateX(-Math.PI/2);
            this.waterMesh = new THREE.Mesh(wGeo, new THREE.MeshLambertMaterial({color: 0x051a2e, transparent: true, opacity: 0.9}));
            this.scene.add(this.waterMesh);

            const sGrp = new THREE.Group();
            sGrp.add(new THREE.Mesh(new THREE.BoxGeometry(20, 15, 120).translate(0,7.5,0), new THREE.MeshLambertMaterial({color: 0x2C3034})));
            sGrp.add(new THREE.Mesh(new THREE.BoxGeometry(10, 20, 30).translate(0,20,10), new THREE.MeshLambertMaterial({color: 0x3F444A})));
            for(let i=0; i<15; i++) {
                const s = sGrp.clone();
                s.position.set((Math.random()-0.5)*6000, 0, 2000 - Math.random()*8000);
                s.rotation.y = Math.random()*Math.PI*2;
                this.scene.add(s);
                this.targets.push({ mesh: s, hp: 200, maxHp: 200, active: true, type: 'SHIP', vx: Math.sin(s.rotation.y)*20, vz: Math.cos(s.rotation.y)*20 });
            }
        }
        else if (this.level === 3) { // Train
            const g = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshLambertMaterial({color: 0x111111}));
            g.rotateX(-Math.PI/2); this.scene.add(g);
            
            const track = new THREE.Mesh(new THREE.BoxGeometry(4000, 2, 20000), new THREE.MeshBasicMaterial({color: 0x0a0a0a}));
            track.position.set(0, 1, 0); this.scene.add(track);

            for(let i=0; i<20; i++) {
                const c = new THREE.Mesh(new THREE.BoxGeometry(20, 25, 60).translate(0,12.5,0), new THREE.MeshLambertMaterial({color: 0x333333}));
                c.position.set((Math.random()-0.5)*1000, 2, 4000 - (i*200) - Math.random()*2000);
                this.scene.add(c);
                this.targets.push({ mesh: c, hp: 100, maxHp: 100, active: true, type: 'TRAIN', vz: -50 });
            }
        }
    }

    public toggleCamera() {
        if(this.isGroundMode) return;
        this.activeCamera = this.activeCamera === this.cameraFLIR ? this.cameraChase : this.cameraFLIR;
        this.sync();
    }

    public toggleGroundMode() {
        if(this.level !== 1) return;
        this.isGroundMode = !this.isGroundMode;
        if(this.isGroundMode) {
            this.activeCamera = this.cameraGround;
            this.cameraGround.position.set(this.drone.position.x, 0, this.drone.position.z - 500);
            this.cameraGround.position.y = terrainHeight(this.cameraGround.position.x, this.cameraGround.position.z) + 10;
        } else {
            this.activeCamera = this.cameraFLIR;
        }
        this.sync();
    }

    public fire() {
        this.shake = 0.5;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10).rotateX(Math.PI/2), new THREE.MeshBasicMaterial({color: 0xff4400}));
        b.position.copy(this.isGroundMode ? this.cameraGround.position : this.drone.position);
        
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(0,0), this.activeCamera);
        this.missiles.push({ mesh: b, vel: rc.ray.direction.multiplyScalar(3000), life: 4.0 });
        this.scene.add(b);
    }

    private sync() {
        if(!this.onSync) return;
        let tHit = 0; let tTot = this.targets.length;
        this.targets.forEach(t => { if(!t.active) tHit++; });
        if(tHit === tTot && tTot > 0 && this.onVictory) this.onVictory();
        
        let cName = this.isGroundMode ? "GROUND ASSAULT" : (this.activeCamera === this.cameraFLIR ? "FLIR INTERNAL" : "CHASE EXTERNAL");
        this.onSync({ cam: cName, progress: Math.floor((tHit/tTot)*100)||0, hp: 100, mode: this.isGroundMode });
    }

    private spawnExplosion(pos: THREE.Vector3) {
        const geo = new THREE.BufferGeometry();
        const pts = new Float32Array(150); const vels =[];
        for(let i=0; i<150; i+=3) {
            pts[i]=pos.x; pts[i+1]=pos.y; pts[i+2]=pos.z;
            vels.push(new THREE.Vector3((Math.random()-0.5)*2, Math.random(), (Math.random()-0.5)*2).normalize().multiplyScalar(200+Math.random()*200));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const ptsMesh = new THREE.Points(geo, new THREE.PointsMaterial({color: 0xffaa00, size: 20, transparent: true}));
        this.scene.add(ptsMesh);
        this.explosions.push({mesh:ptsMesh, life:1.0, vels});
        this.sync();
    }

    private animate = () => {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const t = this.clock.getElapsedTime();

        // Drone movement
        this.drone.position.z -= 400 * dt;
        this.drone.position.x += this.input.x * 1000 * dt;
        this.drone.rotation.z = -this.input.x * 0.5;

        // Targets
        for(let i=0; i<this.targets.length; i++) {
            let tr = this.targets[i];
            if(!tr.active) continue;
            if(tr.type === 'SHIP' && tr.vx && tr.vz) {
                tr.mesh.position.x += tr.vx * dt; tr.mesh.position.z += tr.vz * dt;
            }
            if(tr.type === 'TRAIN' && tr.vz) {
                tr.mesh.position.z += tr.vz * dt;
            }
        }

        // Missiles
        for(let i=this.missiles.length-1; i>=0; i--) {
            let m = this.missiles[i];
            m.life -= dt;
            m.mesh.position.addScaledVector(m.vel, dt);
            let hit = false;

            if(m.mesh.position.y < (this.level===1 ? terrainHeight(m.mesh.position.x, m.mesh.position.z) : 0)) hit = true;
            if(!hit) {
                for(let j=0; j<this.targets.length; j++) {
                    let tr = this.targets[j];
                    if(tr.active && tr.mesh.position.distanceTo(m.mesh.position) < (tr.type==='SHIP'?50:20)) {
                        tr.hp -= 50; hit = true;
                        if(tr.hp <= 0) { tr.active = false; tr.mesh.visible = false; this.spawnExplosion(tr.mesh.position); }
                        break;
                    }
                }
            }
            if(hit || m.life<=0) { this.scene.remove(m.mesh); this.missiles.splice(i,1); this.spawnExplosion(m.mesh.position);}
        }

        // Explosions
        for(let i=this.explosions.length-1; i>=0; i--) {
            let ex = this.explosions[i]; ex.life -= dt;
            const pArr = ex.mesh.geometry.attributes.position.array as Float32Array;
            for(let j=0; j<ex.vels.length; j++) {
                pArr[j*3] += ex.vels[j].x*dt; pArr[j*3+1] += ex.vels[j].y*dt; pArr[j*3+2] += ex.vels[j].z*dt;
            }
            ex.mesh.geometry.attributes.position.needsUpdate = true;
            (ex.mesh.material as THREE.PointsMaterial).opacity = ex.life;
            if(ex.life<=0) { this.scene.remove(ex.mesh); this.explosions.splice(i,1); }
        }

        // Water
        if(this.waterMesh) {
            const p = this.waterMesh.geometry.attributes.position.array as Float32Array;
            for(let i=0; i<this.waterMesh.geometry.attributes.position.count; i++) {
                p[i*3+1] = Math.sin(p[i*3]*0.005 + t*2)*10 + Math.cos(p[i*3+2]*0.005 + t*2)*10;
            }
            this.waterMesh.geometry.attributes.position.needsUpdate = true;
        }

        // Cameras
        if(this.isGroundMode) {
            const rSpeed = 1.5 * dt; const mSpeed = 200 * dt;
            this.cameraGround.rotation.y -= this.input.x * rSpeed;
            this.cameraGround.rotation.x -= this.input.y * rSpeed;
            this.cameraGround.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.cameraGround.rotation.x));
            
            this.cameraGround.translateZ(-Math.abs(this.input.y) * mSpeed);
            this.cameraGround.position.y = terrainHeight(this.cameraGround.position.x, this.cameraGround.position.z) + 15;
            
        } else {
            this.cameraChase.position.copy(this.drone.position).add(new THREE.Vector3(0, 30, 80));
            this.cameraChase.lookAt(this.drone.position);
            
            this.cameraFLIR.position.copy(this.drone.position).add(new THREE.Vector3(0, -2, -10));
            this.cameraFLIR.rotation.set(-Math.PI/4 - this.input.y*0.5, -this.input.x*0.5, 0, 'YXZ');
        }

        if(this.shake > 0) {
            this.shake -= dt;
            this.activeCamera.position.x += (Math.random()-0.5)*10;
            this.activeCamera.position.y += (Math.random()-0.5)*10;
        }

        const isFLIR = this.activeCamera === this.cameraFLIR && !this.isGroundMode;
        if (isFLIR) {
            this.scene.overrideMaterial = new THREE.MeshBasicMaterial({color: 0xdddddd}); // Fake FLIR contrast
            this.scene.background = new THREE.Color(0x222222);
            this.scene.fog = null;
        }

        this.renderer.render(this.scene, this.activeCamera);
        
        if (isFLIR) {
            this.scene.overrideMaterial = null;
            this.scene.background = new THREE.Color(this.level===1 ? 0x87CEEB : (this.level===2?0x05101a:0x201510));
            this.scene.fog = new THREE.FogExp2(this.scene.background.getHex(), 0.0003);
        }
    };

    private onResize = () => {
        const w = window.innerWidth; const h = window.innerHeight;
        this.renderer.setSize(w, h);
        [this.cameraChase, this.cameraFLIR, this.cameraGround].forEach(c => { c.aspect = w/h; c.updateProjectionMatrix(); });
    }
    public dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
    }
}

// --- CONTROLS ---
function Joystick({ onMove }: { onMove: (x:number, y:number)=>void }) {
    const base = useRef<HTMLDivElement>(null); const stick = useRef<HTMLDivElement>(null);
    const hM = (e: React.PointerEvent) => {
        if(e.buttons===0 || !base.current || !stick.current) return;
        const r = base.current.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width/2); let dy = e.clientY - (r.top + r.height/2);
        const rad = r.width/2; const d = Math.min(Math.hypot(dx,dy), rad); const a = Math.atan2(dy,dx);
        dx = Math.cos(a)*d; dy = Math.sin(a)*d;
        stick.current.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx/rad, dy/rad);
    };
    const hU = () => { if(stick.current) stick.current.style.transform = `translate(0,0)`; onMove(0,0); };
    return (
        <div ref={base} className="w-32 h-32 rounded-full border-2 bg-black/60 touch-none flex items-center justify-center pointer-events-auto" style={{borderColor: C_BORDER}}
            onPointerDown={hM} onPointerMove={hM} onPointerUp={hU} onPointerLeave={hU}>
            <div ref={stick} className="w-10 h-10 rounded-full border-2 bg-white/20 transition-transform duration-75" style={{borderColor: C_TEXT}} />
        </div>
    );
}

// --- MAIN APP ---
export default function App() {
    const [state, setState] = useState<'MAP' | 'GAME' | 'VICTORY'>('MAP');
    const [save, setSave] = useSaveData();
    const [selLvl, setSelLvl] = useState(1);
    
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalSim | null>(null);
    const [hud, setHud] = useState({cam: 'FLIR INTERNAL', progress: 0, hp: 100, mode: false});

    const LEVELS = [
        { id: 1, n: 'عملية التسلل الجبلي' },
        { id: 2, n: 'القطاع البحري: تدمير القطع الحربية' },
        { id: 3, n: 'غارة خطوط الإمداد: ضرب القطارات والطائرات' }
    ];

    useEffect(() => {
        if(state === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalSim(canvasRef.current, selLvl);
            engineRef.current.onSync = (d) => setHud(h => ({...h, ...d}));
            engineRef.current.onVictory = () => setTimeout(() => setState('VICTORY'), 1500);
        }
        return () => { if(state !== 'GAME' && engineRef.current) { engineRef.current.dispose(); engineRef.current = null; } }
    }, [state, selLvl]);

    const handleVicCont = () => {
        setSave(s => ({ unlockedLevel: Math.max(s.unlockedLevel, selLvl+1), credits: s.credits + 5000 }));
        setState('MAP');
    };

    return (
        <div className="fixed inset-0 overflow-hidden font-mono select-none" dir="rtl" style={{backgroundColor: C_BG, color: C_TEXT, touchAction: 'none'}}>
            
            {/* CRT OVERLAY GLOBALLY APPLIED TO UI */}
            <div className="absolute inset-0 pointer-events-none z-[999]" style={scanlineStyles} />

            {state === 'MAP' && (
                <div className="absolute inset-0 flex flex-col p-8 z-10" style={{backgroundColor: C_BG}}>
                    <div className="flex justify-between items-center mb-12 border-b pb-4" style={{borderColor: C_BORDER}}>
                        <h1 className="text-3xl font-black tracking-widest uppercase">القيادة الإستراتيجية العليا</h1>
                        <div className="text-xl px-4 py-2 border" style={{background: C_PANEL, borderColor: C_BORDER}}>الاعتمادات المخصصة: <span className="text-white">{save.credits}</span></div>
                    </div>
                    
                    <div className="flex-1 flex gap-6 overflow-x-auto pb-8 items-center justify-center">
                        {LEVELS.map((l, i) => {
                            const locked = l.id > save.unlockedLevel;
                            return (
                                <div key={l.id} className="relative flex-shrink-0 w-80 h-[400px] border-2 flex flex-col transition-transform hover:scale-105" 
                                     style={{borderColor: locked ? '#222' : C_BORDER, background: C_PANEL}}>
                                    <div className="h-48 border-b relative overflow-hidden" style={{borderColor: C_BORDER, background: locked ? '#111' : '#1A2C20'}}>
                                        {locked && <div className="absolute inset-0 backdrop-blur-md bg-black/50 flex items-center justify-center z-10"><LockIcon /></div>}
                                        {!locked && <div className="absolute inset-0 flex items-center justify-center"><TargetIcon /></div>}
                                    </div>
                                    <div className="p-6 flex-1 flex flex-col justify-between">
                                        <div>
                                            <div className="text-xs mb-2 opacity-50 font-bold uppercase tracking-widest">قطاع العمليات 0{l.id}</div>
                                            <h3 className="text-xl font-bold leading-relaxed shadow-sm" style={{color: locked ? '#555' : 'white'}}>{l.n}</h3>
                                        </div>
                                        <button onClick={() => { setSelLvl(l.id); setState('GAME'); }} disabled={locked}
                                                className="w-full py-4 font-bold tracking-widest border transition-colors disabled:opacity-30 disabled:cursor-not-allowed" 
                                                style={{borderColor: C_BORDER, color: locked ? '#555' : C_TEXT, background: locked ? 'transparent' : C_BG}}>
                                            {locked ? 'القطاع مغلق' : 'تأكيد النشر التكتيكي'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {state === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
                    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10" style={hud.cam.includes('FLIR') ? { filter: 'grayscale(100%) contrast(1.5)' } : {}}>
                        
                        {/* HUD TOP */}
                        <div className="flex justify-between items-start">
                            <div className="flex flex-col gap-2">
                                <div className="border px-4 py-2 font-bold tracking-widest text-sm flex gap-4 backdrop-blur-sm" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    <span>SYSTEM: {hud.cam}</span>
                                    <span className="text-white">|</span>
                                    <span>INTEGRITY: {hud.hp}%</span>
                                </div>
                                <div className="border px-4 py-2 font-bold text-xs flex flex-col gap-1 backdrop-blur-sm w-64" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    <span>تطهير القطاع: {hud.progress}%</span>
                                    <div className="w-full h-1 bg-black"><div className="h-full bg-green-500 transition-all" style={{width: `${hud.progress}%`}}/></div>
                                </div>
                            </div>
                            
                            <div className="flex gap-4 pointer-events-auto">
                                {selLvl === 1 && (
                                    <button onClick={() => engineRef.current?.toggleGroundMode()} className="border p-2 hover:bg-white/10 transition-colors" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                        <ChevronDown />
                                    </button>
                                )}
                                <button onClick={() => engineRef.current?.toggleCamera()} disabled={hud.mode} className="border px-6 py-2 font-bold text-sm tracking-widest hover:bg-white/10 transition-colors disabled:opacity-30" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    تبديل الرؤية البصرية
                                </button>
                                <button onClick={() => setState('MAP')} className="border px-6 py-2 font-bold text-sm tracking-widest text-red-500 hover:bg-red-900/50 transition-colors" style={{borderColor: '#522', background: '#211'}}>
                                    إخلاء فوري
                                </button>
                            </div>
                        </div>

                        {/* CENTER RETICLE */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-70">
                            <div className="w-48 h-48 relative">
                                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2" style={{borderColor: C_TEXT}} />
                                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2" style={{borderColor: C_TEXT}} />
                                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2" style={{borderColor: C_TEXT}} />
                                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2" style={{borderColor: C_TEXT}} />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-[1px]" style={{background: C_TEXT, opacity: 0.3}} />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1px] h-32" style={{background: C_TEXT, opacity: 0.3}} />
                                <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2" style={{background: C_TEXT, boxShadow: `0 0 10px ${C_TEXT}`}} />
                            </div>
                        </div>

                        {/* HUD BOTTOM */}
                        <div className="flex justify-between items-end pb-8 px-4">
                            <Joystick onMove={(x, y) => { if(engineRef.current) { engineRef.current.input.x = x; engineRef.current.input.y = y; } }} />
                            
                            <div className="flex flex-col items-center gap-4 pointer-events-auto z-20">
                                <div className="border border-red-900 bg-black/80 px-8 py-2 font-bold text-red-500 tracking-widest text-sm uppercase">Auto-Guided Rocket</div>
                                <button onPointerDown={(e) => { e.stopPropagation(); engineRef.current?.fire(); }} 
                                        className="w-28 h-28 rounded-full border-[4px] border-[#3F444A] bg-[#cc0000] shadow-[0_0_0_2px_#1A1C1E] active:scale-95 active:bg-[#ff0000] transition-all flex items-center justify-center relative overflow-hidden outline-none">
                                    <div className="absolute inset-0 flex items-center justify-center">
                                       <TargetIcon />
                                    </div>
                                    <span className="relative text-white font-black text-xl tracking-widest shadow-black drop-shadow-md">FIRE</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {state === 'VICTORY' && (
                <div className="absolute inset-0 backdrop-blur-xl flex flex-col items-center justify-center z-50 p-8" style={{background: 'rgba(26, 28, 30, 0.85)'}}>
                    <div className="border p-12 flex flex-col items-center text-center max-w-2xl w-full" style={{borderColor: C_BORDER, background: C_PANEL}}>
                        <TargetIcon />
                        <h2 className="text-4xl font-black mt-8 mb-4 tracking-widest">تم تحقيق النصر التكتيكي</h2>
                        <p className="text-white opacity-80 text-lg mb-8">تم مسح القطاع بنجاح وتأمين الأهداف الحيوية.</p>
                        
                        <div className="w-full flex justify-between items-center border-t border-b py-4 mb-8" style={{borderColor: C_BORDER}}>
                            <span className="font-bold uppercase tracking-widest">مكافأة الاعتمادات</span>
                            <span className="text-xl font-bold text-white">+5,000 CR</span>
                        </div>

                        <button onClick={handleVicCont} className="w-full py-4 text-xl font-bold tracking-widest border border-white bg-white text-black hover:bg-gray-300 transition-colors uppercase">
                            تأكيد ومتابعة التحديثات
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
