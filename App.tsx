import React, { useState, useEffect, useRef, useMemo } from 'react';
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
const TargetIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-full h-full opacity-50">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="2" x2="12" y2="22"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
    </svg>
);
const ChevronDownIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-white">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
);

// --- PERSISTENT STATE ---
interface SaveData {
    unlockedLevel: number;
    credits: number;
    inventory: string[];
    activeSkin: string;
    highScore: number;
}
function useSaveData() {
    const [d, setD] = useState<SaveData>(() => {
        try {
            const v = localStorage.getItem('TAC_SIM_SAVE_V3');
            return v ? JSON.parse(v) : { unlockedLevel: 1, credits: 0, inventory: [], activeSkin: 'default', highScore: 0 };
        } catch { return { unlockedLevel: 1, credits: 0, inventory: [], activeSkin: 'default', highScore: 0 }; }
    });
    useEffect(() => { localStorage.setItem('TAC_SIM_SAVE_V3', JSON.stringify(d)); }, [d]);
    return [d, setD] as const;
}

// --- PROCEDURAL ENGINE ---
function terrainHeight(x: number, z: number) {
    return (Math.sin(x*0.003)*Math.cos(z*0.003)*200) + (Math.sin(x*0.01 + z*0.015)*40);
}

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
    public onVictory?: (score: number) => void;
    public onSync?: (data: any) => void;
    public onGodModeTrigger?: () => void;
    
    private shake = 0;
    private flashFrames = 0;
    private godMode = false;
    private pyramid?: THREE.Mesh;
    public isGroundMode = false;

    private bgHex = 0x201510;

    constructor(canvas: HTMLCanvasElement, level: number, skin: string) {
        const w = window.innerWidth; const h = window.innerHeight;
        this.level = level;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        
        this.scene = new THREE.Scene();
        this.bgHex = level === 1 ? 0x87CEEB : (level===2 ? 0x05101a : 0x201510);
        this.scene.fog = new THREE.FogExp2(this.bgHex, 0.0003);
        this.scene.background = new THREE.Color(this.bgHex);

        this.cameraChase = new THREE.PerspectiveCamera(60, w/h, 1, 20000);
        this.cameraFLIR = new THREE.PerspectiveCamera(30, w/h, 1, 20000);
        this.cameraGround = new THREE.PerspectiveCamera(70, w/h, 1, 20000);
        this.activeCamera = this.cameraFLIR;

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(500, 2000, 500);
        this.scene.add(amb, dir);

        // Drone Material Logic
        let dColor = 0x343A40; let dEmissive = 0x000000; let dMetal = 0.2; let dRough = 0.9;
        if (skin.includes('ريال مدريد')) { dColor = 0xffffff; dEmissive = 0x221100; dMetal = 1.0; dRough = 0.1; }
        else if (skin.includes('برشلونة')) { dColor = 0x000044; dEmissive = 0x330000; dMetal = 0.8; dRough = 0.3; }

        this.drone = new THREE.Group();
        const matMatte = new THREE.MeshStandardMaterial({color: dColor, emissive: dEmissive, roughness: dRough, metalness: dMetal});
        
        // B2 Geometry
        const dBody = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 12), matMatte);
        const dWing = new THREE.Mesh(new THREE.BufferGeometry(), matMatte);
        const wPts = new Float32Array([0,0,-4, 25,0,8, 0,0,4, 0,0,-4, 0,0,4, -25,0,8]);
        dWing.geometry.setAttribute('position', new THREE.BufferAttribute(wPts, 3));
        dWing.geometry.computeVertexNormals();
        const dStabL = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), matMatte);
        dStabL.position.set(20, 1, 6);
        const dStabR = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), matMatte);
        dStabR.position.set(-20, 1, 6);

        this.drone.add(dBody, dWing, dStabL, dStabR);
        this.drone.position.set(0, 1500, 4000);
        this.scene.add(this.drone);

        this.buildLevel();
        
        // Time-Locked Easter Egg
        const hour = new Date().getHours();
        if (hour >= 15 && hour < 17 && level === 1) {
            const pGeo = new THREE.ConeGeometry(80, 150, 4);
            const pMat = new THREE.MeshLambertMaterial({color: 0xffdd00, emissive: 0xaa6600, wireframe: true});
            this.pyramid = new THREE.Mesh(pGeo, pMat);
            this.pyramid.position.set((Math.random()-0.5)*3000, terrainHeight(0,0) + 200, 1000);
            this.scene.add(this.pyramid);
        }

        window.addEventListener('resize', this.onResize);
        this.renderer.setAnimationLoop(this.animate);
    }

    private buildLevel() {
        if (this.level === 1) {
            const th = new THREE.PlaneGeometry(16000, 16000, 128, 128); th.rotateX(-Math.PI/2);
            const pos = th.attributes.position; const colors = []; const c = new THREE.Color();
            for(let i=0; i<pos.count; i++) {
                const x = pos.getX(i); const z = pos.getZ(i); const y = terrainHeight(x, z); pos.setY(i, y);
                if(y>100) c.setHex(0x5a4d41); else c.setHex(0x4a5d23);
                colors.push(c.r, c.g, c.b);
            }
            th.computeVertexNormals(); th.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            this.scene.add(new THREE.Mesh(th, new THREE.MeshLambertMaterial({vertexColors: true})));

            const eGeo = new THREE.CylinderGeometry(6, 6, 20); eGeo.translate(0, 10, 0);
            const eMat = new THREE.MeshLambertMaterial({color: 0x220000, emissive: 0x110000});
            for(let i=0; i<25; i++) {
                const e = new THREE.Mesh(eGeo, eMat);
                e.position.set((Math.random()-0.5)*4000, 0, 3000 - Math.random()*8000);
                e.position.y = terrainHeight(e.position.x, e.position.z);
                this.scene.add(e);
                this.targets.push({ mesh: e, hp: 50, maxHp: 50, active: true, type: 'INFANTRY' });
            }
        } 
        else if (this.level === 2) {
            const wGeo = new THREE.PlaneGeometry(20000, 20000, 128, 128); wGeo.rotateX(-Math.PI/2);
            this.waterMesh = new THREE.Mesh(wGeo, new THREE.MeshLambertMaterial({color: 0x051a2e, transparent: true, opacity: 0.9}));
            this.scene.add(this.waterMesh);

            const sGrp = new THREE.Group();
            sGrp.add(new THREE.Mesh(new THREE.BoxGeometry(20, 15, 120).translate(0,7.5,0), new THREE.MeshLambertMaterial({color: 0x2C3034})));
            for(let i=0; i<15; i++) {
                const s = sGrp.clone();
                s.position.set((Math.random()-0.5)*6000, 0, 2000 - Math.random()*8000);
                s.rotation.y = Math.random()*Math.PI*2;
                this.scene.add(s);
                this.targets.push({ mesh: s, hp: 200, maxHp: 200, active: true, type: 'SHIP', vx: Math.sin(s.rotation.y)*20, vz: Math.cos(s.rotation.y)*20 });
            }
        }
        else if (this.level === 3) {
            const g = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshLambertMaterial({color: 0x111111}));
            g.rotateX(-Math.PI/2); this.scene.add(g);
            
            const track = new THREE.Mesh(new THREE.BoxGeometry(4000, 2, 20000), new THREE.MeshBasicMaterial({color: 0x2C3034}));
            track.position.set(0, 1, 0); this.scene.add(track);

            for(let i=0; i<20; i++) {
                const c = new THREE.Mesh(new THREE.BoxGeometry(25, 30, 80).translate(0,15,0), new THREE.MeshLambertMaterial({color: 0x330000}));
                c.position.set((Math.random()-0.5)*1000, 2, 4000 - (i*200) - Math.random()*2000);
                this.scene.add(c);
                this.targets.push({ mesh: c, hp: 300, maxHp: 300, active: true, type: 'TRAIN', vz: -60 });
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
            this.cameraGround.position.y = terrainHeight(this.cameraGround.position.x, this.cameraGround.position.z) + 15;
            this.cameraGround.rotation.set(0,0,0);
        } else {
            this.activeCamera = this.cameraFLIR;
        }
        this.sync();
    }

    public fire() {
        this.shake = 1.0;
        this.flashFrames = 3; 
        const b = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 15).rotateX(Math.PI/2), new THREE.MeshBasicMaterial({color: 0xffff00}));
        b.position.copy(this.isGroundMode ? this.cameraGround.position : this.drone.position);
        
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(0,0), this.activeCamera);
        this.missiles.push({ mesh: b, vel: rc.ray.direction.multiplyScalar(4000), life: 3.0 });
        this.scene.add(b);
    }

    private sync() {
        if(!this.onSync) return;
        let tHit = 0; let tTot = this.targets.length;
        this.targets.forEach(t => { if(!t.active) tHit++; });
        if(tHit === tTot && tTot > 0 && this.onVictory) {
            const score = (this.level * 1000) + (this.godMode ? 5000 : 0);
            this.onVictory(score);
        }
        
        let cName = this.isGroundMode ? "GROUND ASSAULT" : (this.activeCamera === this.cameraFLIR ? "FLIR INTERNAL" : "CHASE EXTERNAL");
        this.onSync({ cam: cName, progress: Math.floor((tHit/tTot)*100)||0, hp: this.godMode ? 'INF' : 100, godMode: this.godMode });
    }

    private spawnExplosion(pos: THREE.Vector3) {
        this.shake = 2.0; this.flashFrames = 5;
        const geo = new THREE.BufferGeometry();
        const pts = new Float32Array(300); const vels =[];
        for(let i=0; i<300; i+=3) {
            pts[i]=pos.x; pts[i+1]=pos.y; pts[i+2]=pos.z;
            vels.push(new THREE.Vector3((Math.random()-0.5)*2, Math.random(), (Math.random()-0.5)*2).normalize().multiplyScalar(400+Math.random()*400));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const ptsMesh = new THREE.Points(geo, new THREE.PointsMaterial({color: 0xffaa00, size: 30, transparent: true}));
        this.scene.add(ptsMesh);
        this.explosions.push({mesh:ptsMesh, life:1.5, vels});
        this.sync();
    }

    private animate = () => {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const t = this.clock.getElapsedTime();

        if(!this.isGroundMode) {
            this.drone.position.z -= 600 * dt;
            this.drone.position.x += this.input.x * 1500 * dt;
            this.drone.rotation.z = -this.input.x * 0.8;
        }

        if (this.pyramid) {
            this.pyramid.rotation.y += 2*dt;
            if (this.isGroundMode) {
                 if (this.cameraGround.position.distanceTo(this.pyramid.position) < 300) {
                     this.godMode = true;
                     this.scene.remove(this.pyramid);
                     this.pyramid = undefined;
                     this.flashFrames = 20;
                     if(this.onGodModeTrigger) this.onGodModeTrigger();
                     this.sync();
                 }
            } else {
                if (this.drone.position.distanceTo(this.pyramid.position) < 300) {
                    this.godMode = true;
                    this.scene.remove(this.pyramid);
                    this.pyramid = undefined;
                    this.flashFrames = 20;
                    if(this.onGodModeTrigger) this.onGodModeTrigger();
                    this.sync();
                }
            }
        }

        for(let i=0; i<this.targets.length; i++) {
            let tr = this.targets[i];
            if(!tr.active) continue;
            if(tr.type === 'SHIP' && tr.vx && tr.vz) { tr.mesh.position.x += tr.vx * dt; tr.mesh.position.z += tr.vz * dt; }
            if(tr.type === 'TRAIN' && tr.vz) { tr.mesh.position.z += tr.vz * dt; }
        }

        for(let i=this.missiles.length-1; i>=0; i--) {
            let m = this.missiles[i];
            m.life -= dt; m.mesh.position.addScaledVector(m.vel, dt);
            let hit = false;
            
            if(this.pyramid && m.mesh.position.distanceTo(this.pyramid.position) < 100) {
                this.godMode = true; this.scene.remove(this.pyramid); this.pyramid = undefined; this.flashFrames = 20;
                if(this.onGodModeTrigger) this.onGodModeTrigger();
                this.sync();
            }

            if(m.mesh.position.y < (this.level===1 ? terrainHeight(m.mesh.position.x, m.mesh.position.z) : 0)) hit = true;
            if(!hit) {
                for(let j=0; j<this.targets.length; j++) {
                    let tr = this.targets[j];
                    if(tr.active && tr.mesh.position.distanceTo(m.mesh.position) < (tr.type==='SHIP'?80:40)) {
                        tr.hp -= this.godMode ? 99999 : 50; hit = true;
                        if(tr.hp <= 0) { tr.active = false; tr.mesh.visible = false; this.spawnExplosion(tr.mesh.position); }
                        break;
                    }
                }
            }
            if(hit || m.life<=0) { this.scene.remove(m.mesh); this.missiles.splice(i,1); if(hit) this.spawnExplosion(m.mesh.position);}
        }

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

        if(this.waterMesh) {
            const p = this.waterMesh.geometry.attributes.position.array as Float32Array;
            for(let i=0; i<this.waterMesh.geometry.attributes.position.count; i++) {
                p[i*3+1] = Math.sin(p[i*3]*0.005 + t*2)*10 + Math.cos(p[i*3+2]*0.005 + t*2)*10;
            }
            this.waterMesh.geometry.attributes.position.needsUpdate = true;
        }

        if(this.isGroundMode) {
            const rSpeed = 1.5 * dt; const mSpeed = 300 * dt;
            this.cameraGround.rotation.y -= this.input.x * rSpeed;
            this.cameraGround.rotation.x -= this.input.y * rSpeed;
            this.cameraGround.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.cameraGround.rotation.x));
            this.cameraGround.translateZ(-Math.abs(this.input.y) * mSpeed);
            this.cameraGround.position.y = terrainHeight(this.cameraGround.position.x, this.cameraGround.position.z) + 15;
            this.drone.position.x = this.cameraGround.position.x;
            this.drone.position.z = this.cameraGround.position.z + 500;
        } else {
            this.cameraChase.position.copy(this.drone.position).add(new THREE.Vector3(0, 40, 100));
            this.cameraChase.lookAt(this.drone.position);
            
            this.cameraFLIR.position.copy(this.drone.position).add(new THREE.Vector3(0, -5, -20));
            this.cameraFLIR.rotation.set(-Math.PI/4 - this.input.y*0.5, -this.input.x*0.5, 0, 'YXZ');
        }

        let sx = 0; let sy = 0;
        if(this.shake > 0) {
            this.shake -= dt*5; if(this.shake < 0) this.shake = 0;
            sx = (Math.random()-0.5)*20*this.shake;
            sy = (Math.random()-0.5)*20*this.shake;
            this.activeCamera.position.x += sx; this.activeCamera.position.y += sy;
        }

        // Strobe
        if (this.flashFrames > 0) {
            this.scene.background = new THREE.Color(this.flashFrames % 2 === 0 ? 0xffffff : 0xaa0000);
            this.flashFrames--;
        } else if (this.activeCamera === this.cameraFLIR && !this.isGroundMode) {
            this.scene.background = new THREE.Color(0x222222);
            this.scene.overrideMaterial = new THREE.MeshBasicMaterial({color: 0xdddddd});
            this.scene.fog = null;
        } else {
            this.scene.background = new THREE.Color(this.bgHex);
            this.scene.overrideMaterial = null;
            this.scene.fog = new THREE.FogExp2(this.bgHex, 0.0003);
        }

        this.renderer.render(this.scene, this.activeCamera);
        
        if (this.shake > 0) {
            this.activeCamera.position.x -= sx; this.activeCamera.position.y -= sy;
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

// --- MAIN APP COMPONENT ---
export default function App() {
    const [state, setState] = useState<'MAP' | 'GAME' | 'LOOTBOX' | 'VICTORY'>('MAP');
    const [tab, setTab] = useState<'OPS' | 'HANGAR' | 'LAN'>('OPS');
    const [save, setSave] = useSaveData();
    const [selLvl, setSelLvl] = useState(1);
    const [lootResult, setLootResult] = useState<{tier: number, msg: string, glitch: boolean, prize?: string} | null>(null);
    const [latestScore, setLatestScore] = useState(0);
    const [godMsg, setGodMsg] = useState(false);
    
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalSim | null>(null);
    const [hud, setHud] = useState({cam: 'FLIR INTERNAL', progress: 0, hp: '100', godMode: false});

    const LEVELS = [
        { id: 1, n: 'عملية التسلل الجبلي' },
        { id: 2, n: 'القطاع البحري: تدمير القطع الحربية' },
        { id: 3, n: 'غارة خطوط الإمداد: تدمير القطارات والطائرات' }
    ];

    const MOCK_LAN = useMemo(() => {
        let players = [
            { name: "صقر_شرعب", score: 14500 },
            { name: "النمر_التكتيكي", score: 12200 },
            { name: "جنرال_المقهى", score: 9800 },
            { name: "ذئب_الليل", score: 8500 },
            { name: "قناص_العرب", score: 7100 },
            { name: "أنت (محلي)", score: save.highScore }
        ];
        return players.sort((a,b) => b.score - a.score);
    }, [save.highScore]);

    useEffect(() => {
        if(state === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalSim(canvasRef.current, selLvl, save.activeSkin);
            engineRef.current.onSync = (d) => setHud(h => ({...h, ...d}));
            engineRef.current.onGodModeTrigger = () => { setGodMsg(true); setTimeout(()=>setGodMsg(false), 4000); };
            engineRef.current.onVictory = (score) => {
                setLatestScore(score);
                setTimeout(() => setState('VICTORY'), 1500);
            };
        }
        return () => { if(state !== 'GAME' && engineRef.current) { engineRef.current.dispose(); engineRef.current = null; } }
    }, [state, selLvl, save.activeSkin]);

    const handleLootRoll = () => {
        const r = Math.random();
        let res;
        if (r < 0.40) {
            res = { tier: 3, msg: "فشل الاتصال بالصندوق - حاول في الغارة القادمة", glitch: true };
        } else if (r < 0.85) {
            res = { tier: 1, msg: "50 Gold Credits + شظايا تقنية عادية", glitch: false, prize: 'CREDITS' };
            setSave(s => ({...s, credits: s.credits + 50}));
        } else {
            const skins = ["العقاب الفضي", "مقاتل المقاومة الرمادي"];
            const sName = skins[Math.floor(Math.random()*skins.length)];
            res = { tier: 2, msg: `فتح حصري: ${sName}`, glitch: false, prize: sName };
            setSave(s => ({...s, inventory: Array.from(new Set([...s.inventory, sName]))}));
        }
        setLootResult(res);
    };

    const handleVicCont = () => {
        setSave(s => ({ 
            ...s, 
            unlockedLevel: Math.max(s.unlockedLevel, selLvl+1), 
            highScore: Math.max(s.highScore, latestScore) 
        }));
        setState('LOOTBOX');
    };

    const premiumSkins = [
        { id: 'حزمة النخبة الملكية - ريال مدريد الكونية', color: '#ffdd00', price: 999999 },
        { id: 'كتيبة النخبة - برشلونة التكتيكية', color: '#ff2255', price: 999999 }
    ];

    return (
        <div className="fixed inset-0 overflow-hidden font-mono select-none" dir="rtl" style={{backgroundColor: C_BG, color: C_TEXT, touchAction: 'none'}}>
            
            {/* PORTRAIT WARNING */}
            <div className="absolute inset-0 z-[9999] flex flex-col items-center justify-center text-center p-8 portrait:flex landscape:hidden" style={{background: '#0a0a0a'}}>
                <div className="w-16 h-16 border-4 border-red-600 border-t-transparent rounded-full animate-spin mb-6" />
                <h1 className="text-3xl font-black text-red-600 mb-4 tracking-widest">تحذير نظامي</h1>
                <p className="text-white text-lg max-w-md opacity-80 leading-relaxed shadow-red-900 drop-shadow-lg">
                    [ERR_ORIENTATION] الرجاء تدوير الجهاز للوضع العرضي (Landscape) لتفعيل مصفوفة التحكم القتالية واستقرار المحرك.
                </p>
            </div>

            {/* CRT OVERLAY */}
            <div className="absolute inset-0 pointer-events-none z-[900]" style={scanlineStyles} />

            {/* MAP & MENU */}
            {state === 'MAP' && (
                <div className="absolute inset-0 flex flex-col p-6 z-10" style={{backgroundColor: C_BG}}>
                    <div className="flex justify-between items-end mb-8 border-b pb-4" style={{borderColor: C_BORDER}}>
                        <div>
                            <h1 className="text-3xl font-black tracking-widest uppercase mb-2 text-white shadow-black drop-shadow-md">القيادة الإستراتيجية العليا</h1>
                            <div className="flex gap-4">
                                <button onClick={()=>setTab('OPS')} className={`px-4 py-2 border font-bold ${tab==='OPS'?'bg-white/10 text-white':'text-gray-500 hover:bg-white/5'}`} style={{borderColor: C_BORDER}}>العمليات التكتيكية</button>
                                <button onClick={()=>setTab('HANGAR')} className={`px-4 py-2 border font-bold ${tab==='HANGAR'?'bg-white/10 text-white':'text-gray-500 hover:bg-white/5'}`} style={{borderColor: C_BORDER}}>المستودع والدروع</button>
                                <button onClick={()=>setTab('LAN')} className={`px-4 py-2 border font-bold ${tab==='LAN'?'bg-white/10 text-white':'text-gray-500 hover:bg-white/5'}`} style={{borderColor: C_BORDER}}>بطولة الحارة - شبكة LAN محلية (Ping: 0ms)</button>
                            </div>
                        </div>
                        <div className="text-xl px-6 py-3 border font-black tracking-widest bg-emerald-900/40 text-[#00FF66]" style={{borderColor: '#005522'}}>
                            الاعتمادات: {save.credits}
                        </div>
                    </div>
                    
                    {tab === 'OPS' && (
                        <div className="flex-1 flex gap-6 overflow-x-auto pb-4 items-center justify-center">
                            {LEVELS.map((l, i) => {
                                const locked = l.id > save.unlockedLevel;
                                return (
                                    <div key={l.id} className="relative flex-shrink-0 w-[22rem] h-[24rem] border flex flex-col transition-transform hover:scale-[1.02]" 
                                         style={{borderColor: locked ? '#222' : C_BORDER, background: C_PANEL}}>
                                        <div className="h-40 border-b relative overflow-hidden flex-shrink-0" style={{borderColor: C_BORDER, background: locked ? '#111' : '#1A2C20'}}>
                                            {locked && <div className="absolute inset-0 backdrop-blur-xl bg-black/80 flex items-center justify-center z-10"><LockIcon /></div>}
                                            {!locked && <div className="absolute inset-0 flex items-center justify-center scale-150 opacity-20"><TargetIcon /></div>}
                                        </div>
                                        <div className="p-6 flex-1 flex flex-col justify-between">
                                            <div>
                                                <div className="text-xs mb-2 opacity-50 font-bold uppercase tracking-widest text-[#00FF66]">قطاع العمليات 0{l.id}</div>
                                                <h3 className="text-xl font-bold leading-relaxed shadow-sm" style={{color: locked ? '#555' : 'white'}}>{l.n}</h3>
                                            </div>
                                            <button onClick={() => { setSelLvl(l.id); setState('GAME'); }} disabled={locked}
                                                    className="w-full py-4 font-bold tracking-widest border transition-colors disabled:opacity-30 disabled:cursor-not-allowed uppercase" 
                                                    style={{borderColor: C_BORDER, color: locked ? '#555' : C_TEXT, background: locked ? 'transparent' : C_BG}}>
                                                {locked ? 'القطاع مُشفر' : 'تأكيد النشر التكتيكي'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {tab === 'HANGAR' && (
                        <div className="flex-1 overflow-auto grid grid-cols-2 gap-6 p-4">
                            <div className="border p-6 flex flex-col gap-4" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                <h2 className="text-2xl font-black text-white border-b pb-2" style={{borderColor: C_BORDER}}>الأسطول المتاح</h2>
                                <button onClick={()=>setSave(s=>({...s, activeSkin: 'default'}))} className={`p-4 border text-left ${save.activeSkin === 'default' ? 'bg-[#003311]' : ''}`} style={{borderColor:C_BORDER}}>
                                    B-2 Stealth (قياسي) {save.activeSkin==='default'&&'✓'}
                                </button>
                                {save.inventory.map(sk => (
                                    <button key={sk} onClick={()=>setSave(s=>({...s, activeSkin: sk}))} className={`p-4 border text-left ${save.activeSkin === sk ? 'bg-[#003311]' : ''}`} style={{borderColor:C_BORDER}}>
                                        {sk} {save.activeSkin===sk&&'✓'}
                                    </button>
                                ))}
                            </div>
                            <div className="border border-yellow-700 bg-[#1a1500] p-6 flex flex-col gap-4">
                                <h2 className="text-2xl font-black text-yellow-500 border-b border-yellow-800 pb-2">سوق النخبة الحصري (FOMO)</h2>
                                {premiumSkins.map(ps => {
                                    const owned = save.inventory.includes(ps.id);
                                    return (
                                        <div key={ps.id} className="border border-yellow-800/50 p-4 flex justify-between items-center bg-black/50">
                                            <div className="font-bold text-lg" style={{color: ps.color}}>{ps.id}</div>
                                            {owned ? (
                                                <button onClick={()=>setSave(s=>({...s, activeSkin: ps.id}))} className={`px-4 py-2 border border-yellow-500 ${save.activeSkin === ps.id ? 'bg-yellow-900 text-white' : 'bg-transparent'} text-yellow-500`}>
                                                    {save.activeSkin === ps.id ? 'مُجهز' : 'تجهيز'}
                                                </button>
                                            ) : (
                                                <button disabled className="px-4 py-2 border border-yellow-900 text-yellow-700 opacity-50 cursor-not-allowed">
                                                    {ps.price.toLocaleString()} CR - مقفل
                                                </button>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {tab === 'LAN' && (
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <div className="w-full max-w-2xl border bg-black/80 p-8" style={{borderColor: C_BORDER}}>
                                <h2 className="text-3xl font-black text-center mb-8 border-b pb-4 text-white" style={{borderColor: C_BORDER}}>لوحة شرف الأبطال المحلية</h2>
                                {MOCK_LAN.map((p, i) => (
                                    <div key={i} className={`flex justify-between items-center p-4 mb-2 border ${p.name.includes('أنت') ? 'bg-[#003311] border-[#00FF66] font-black' : 'bg-[#2C3034] border-[#3F444A]'}`}>
                                        <div className="flex gap-4"><span className="opacity-50">#{i+1}</span> <span className={p.name.includes('أنت')?'text-white':''}>{p.name}</span></div>
                                        <div className="tracking-widest capitalize">{p.score.toLocaleString()} PTS</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* SIMULATION */}
            {state === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
                    
                    {godMsg && (
                        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 bg-yellow-500 text-black px-8 py-4 font-black text-3xl z-50 animate-pulse tracking-tighter">
                            تنبيه تكتيكي: أنت الآن زعيم الكون العسكري
                        </div>
                    )}

                    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10" style={hud.cam.includes('FLIR') ? { filter: 'grayscale(100%) contrast(1.5)' } : {}}>
                        <div className="flex justify-between items-start">
                            <div className="flex flex-col gap-2">
                                <div className="border px-4 py-2 font-bold tracking-widest text-sm flex gap-4 backdrop-blur-sm shadow-xl" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    <span className={hud.godMode ? 'text-yellow-500':''}>SYS: {hud.cam}</span>
                                    <span className="text-white">|</span>
                                    <span className={hud.godMode ? 'text-yellow-500':''}>DMG_SCALE: {hud.godMode ? 'INF' : 'NOMINAL'}</span>
                                </div>
                                <div className="border px-4 py-2 font-bold text-xs flex flex-col gap-1 backdrop-blur-sm w-64 uppercase" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    <span>Sector Clear: {hud.progress}%</span>
                                    <div className="w-full h-1 bg-black"><div className="h-full bg-green-500 transition-all" style={{width: `${hud.progress}%`}}/></div>
                                </div>
                            </div>
                            
                            <div className="flex gap-4 pointer-events-auto shadow-xl">
                                {selLvl === 1 && (
                                   <button onClick={() => engineRef.current?.toggleGroundMode()} className="border p-2 hover:bg-white/10 transition-colors" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                        <ChevronDownIcon />
                                    </button> 
                                )}
                                <button onClick={() => engineRef.current?.toggleCamera()} disabled={selLvl===1 && engineRef.current?.isGroundMode} className="border px-6 py-2 font-bold text-sm tracking-widest hover:bg-white/10 transition-colors disabled:opacity-30" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    R-STICK: SWAP OPTICS
                                </button>
                                <button onClick={() => setState('MAP')} className="border px-6 py-2 font-bold text-sm tracking-widest text-red-500 hover:bg-red-900/50 transition-colors uppercase" style={{borderColor: '#522', background: '#211'}}>
                                    Abort Mission
                                </button>
                            </div>
                        </div>

                        {/* RETICLE */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-70">
                            <div className="w-48 h-48 relative">
                                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-red-500 rounded-full -translate-x-1/2 -translate-y-1/2" />
                            </div>
                        </div>

                        <div className="flex justify-between items-end pb-4 px-4">
                            <Joystick onMove={(x, y) => { if(engineRef.current) { engineRef.current.input.x = x; engineRef.current.input.y = y; } }} />
                            
                            <div className="flex flex-col items-center gap-4 pointer-events-auto z-20">
                                <div className="border border-red-900 bg-black/80 px-8 py-2 font-bold text-red-500 tracking-widest text-sm uppercase">Hellfire Protocol</div>
                                <button onPointerDown={(e) => { e.stopPropagation(); engineRef.current?.fire(); }} 
                                        className="w-28 h-28 rounded-full border-[4px] border-[#3F444A] bg-[#cc0000] shadow-[0_0_0_2px_#1A1C1E] active:scale-95 active:bg-[#ff0000] transition-all flex items-center justify-center relative overflow-hidden outline-none">
                                    <div className="absolute inset-0 flex items-center justify-center scale-75 opacity-50"><TargetIcon /></div>
                                    <span className="relative text-white font-black text-2xl tracking-wider shadow-black drop-shadow-md uppercase">Strike</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* VICTORY -> LOOTBOX TIMELINE */}
            {state === 'VICTORY' && (
                <div className="absolute inset-0 backdrop-blur-xl flex flex-col items-center justify-center z-50 p-8" style={{background: 'rgba(26, 28, 30, 0.9)'}}>
                    <div className="border p-12 flex flex-col items-center text-center max-w-2xl w-full" style={{borderColor: C_BORDER, background: C_PANEL}}>
                        <TargetIcon />
                        <h2 className="text-4xl font-black mt-8 mb-4 tracking-widest text-white">تم تحقيق النصر التكتيكي ومسح القطاع بنجاح. الاعتمادات في المستودع</h2>
                        <p className="text-[#00FF66] opacity-80 text-xl font-bold mb-8">عملية التطهير الناجحة. الرصيد القتالي: {latestScore.toLocaleString()} PTS</p>
                        <button onClick={handleVicCont} className="w-full py-6 mt-4 text-2xl font-black tracking-widest border border-white bg-white text-black hover:bg-gray-300 transition-colors uppercase">
                            تأكيد الإخلاء
                        </button>
                    </div>
                </div>
            )}

            {state === 'LOOTBOX' && (
                <div className="absolute inset-0 backdrop-blur-2xl flex flex-col items-center justify-center z-50 p-8" style={{background: '#050505'}}>
                    <div className="border-4 p-8 flex flex-col items-center text-center w-[500px]" style={{borderColor: lootResult?.glitch?'#ff0000':C_BORDER, background: '#111'}}>
                        
                        <h2 className="text-2xl font-black mb-8 tracking-widest text-yellow-500 uppercase">فتح صندوق الإمدادات التكتيكية العشوائي</h2>
                        
                        {!lootResult ? (
                            <button onClick={handleLootRoll} className="w-64 h-64 border-4 border-yellow-600 bg-yellow-900/30 hover:bg-yellow-800/50 flex flex-col items-center justify-center gap-4 transition-all hover:scale-105 shadow-[0_0_50px_rgba(255,165,0,0.1)]">
                                <LockIcon />
                                <span className="font-bold text-yellow-500 text-xl tracking-widest">تحفيز الخوارزمية</span>
                            </button>
                        ) : (
                            <div className="w-full flex flex-col items-center animate-in fade-in zoom-in duration-500">
                                <div className={`text-3xl font-black mb-6 px-4 py-8 border-2 w-full ${lootResult.glitch ? 'animate-bounce text-red-500 border-red-900 bg-red-900/20' : 'text-white border-green-500 bg-green-900/20'}`}>
                                    {lootResult.msg}
                                </div>
                                <button onClick={()=>setState('MAP')} className="w-full py-4 font-bold border border-white bg-white text-black hover:bg-gray-300">
                                    العودة لغرفة العمليات
                                </button>
                            </div>
                        )}
                        <div className="mt-8 text-xs font-mono text-gray-600 opacity-50 tracking-widest uppercase">Crypto-RNG Sequence Actuated</div>
                    </div>
                </div>
            )}
        </div>
    );
}
