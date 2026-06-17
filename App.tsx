import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';

// --- STYLING & CRT CONSTANTS ---
const C_BG = '#1A1C1E';
const C_PANEL = '#2C3034';
const C_TEXT = '#00FF66';
const C_BORDER = '#3F444A';

const scanlineStyles = {
    background: 'linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.15) 50%)',
    backgroundSize: '100% 4px',
    pointerEvents: 'none' as const,
};

// --- ICONS ---
const LockIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-red-500 opacity-80">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
);
const TargetIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-full h-full opacity-50">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
);
const CameraIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
    </svg>
);
const DismountIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
        <polyline points="6 9 12 15 18 9" />
        <polyline points="6 15 12 21 18 15" />
    </svg>
);
const JetIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
        <polyline points="18 15 12 9 6 15" />
        <path d="M12 9v13" />
    </svg>
);
const MusicIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
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
            const v = localStorage.getItem('TAC_SIM_SAVE_V5');
            return v ? JSON.parse(v) : { unlockedLevel: 1, credits: 0, inventory: [], activeSkin: 'default', highScore: 0 };
        } catch { return { unlockedLevel: 1, credits: 0, inventory: [], activeSkin: 'default', highScore: 0 }; }
    });
    useEffect(() => { localStorage.setItem('TAC_SIM_SAVE_V5', JSON.stringify(d)); }, [d]);
    return [d, setD] as const;
}

// --- PROCEDURAL FBM MATH ---
function noise(x: number, z: number) {
    return Math.sin(x) * Math.cos(z);
}
function getTerrainHeight(x: number, z: number) {
    let y = 0;
    y += noise(x * 0.003, z * 0.003) * 200;
    y += noise(x * 0.01, z * 0.015) * 40;
    return y;
}

// --- TERRAIN ENGINE ---
class TerrainManager {
    chunks = new Map<string, THREE.Mesh>();
    scene: THREE.Scene;
    mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    update(pos: THREE.Vector3) {
        const size = 2000;
        const cx = Math.floor(pos.x / size);
        const cz = Math.floor(pos.z / size);
        const active = new Set();
        
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const id = `${cx+i}_${cz+j}`;
                active.add(id);
                if (!this.chunks.has(id)) {
                    const geom = new THREE.PlaneGeometry(size, size, 32, 32);
                    geom.rotateX(-Math.PI/2);
                    const positions = geom.attributes.position;
                    const colors = [];
                    const c = new THREE.Color();
                    for (let k = 0; k < positions.count; k++) {
                        const vx = positions.getX(k) + (cx+i)*size;
                        const vz = positions.getZ(k) + (cz+j)*size;
                        const vy = getTerrainHeight(vx, vz);
                        positions.setY(k, vy);
                        
                        if (vy > 100) c.setHex(0x3a4d31); else c.setHex(0x2a3d23);
                        colors.push(c.r, c.g, c.b);
                    }
                    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                    geom.computeVertexNormals();
                    const mesh = new THREE.Mesh(geom, this.mat);
                    mesh.position.set((cx+i)*size, 0, (cz+j)*size);
                    this.scene.add(mesh);
                    this.chunks.set(id, mesh);
                }
            }
        }

        for (const [id, chunk] of this.chunks) {
            if (!active.has(id)) {
                this.scene.remove(chunk);
                chunk.geometry.dispose();
                this.chunks.delete(id);
            }
        }
    }
}

// --- ENGINE CLASS ---
interface TacticalTarget {
    mesh: THREE.Object3D;
    hp: number;
    active: boolean;
}

class TacticalSim {
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    
    public cameraCockpit: THREE.PerspectiveCamera;
    public cameraChase: THREE.PerspectiveCamera;
    public cameraTop: THREE.PerspectiveCamera;
    public cameraFLIR: THREE.PerspectiveCamera;
    public cameraPlayer: THREE.PerspectiveCamera;
    public activeCamera: THREE.PerspectiveCamera;
    public camIndex = 0; // 0=Cockpit, 1=Chase, 2=Top, 3=FLIR

    public jet: THREE.Group;
    public player: THREE.Group;
    public cockpitGroup: THREE.Group;
    public radarRing: THREE.Mesh;
    public radarBlips: THREE.Mesh[] = [];
    
    public targets: TacticalTarget[] = [];
    public missiles: { mesh: THREE.Mesh, vel: THREE.Vector3, life: number }[] = [];
    public explosions: { mesh: THREE.Points, life: number, vels: THREE.Vector3[] }[] = [];
    
    public terrainManager: TerrainManager;
    private clock = new THREE.Clock();
    
    public level: number;
    public state: 'AIR' | 'LANDING' | 'GROUND' | 'BOARDING' | 'CINEMATIC' = 'AIR';
    public input = { x: 0, y: 0 };
    public sprinting = false;
    public crouching = false;
    
    public onVictory?: (score: number) => void;
    public onSync?: (data: any) => void;
    public onGodModeTrigger?: () => void;
    
    private shake = 0;
    private flashFrames = 0;
    private godMode = false;
    private pyramid?: THREE.Mesh;
    private score = 0;
    
    // Cinematic assets
    private cinematicTime = 0;
    private spaceInit = false;
    private stars?: THREE.Points;
    private earth?: THREE.Mesh;

    constructor(canvas: HTMLCanvasElement, level: number, skin: string) {
        const w = window.innerWidth; const h = window.innerHeight;
        this.level = level;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.0002);
        this.scene.background = new THREE.Color(0x87CEEB);

        this.cameraCockpit = new THREE.PerspectiveCamera(60, w/h, 1, 30000);
        this.cameraChase = new THREE.PerspectiveCamera(60, w/h, 1, 30000);
        this.cameraTop = new THREE.PerspectiveCamera(70, w/h, 1, 30000);
        this.cameraFLIR = new THREE.PerspectiveCamera(40, w/h, 1, 30000);
        this.cameraPlayer = new THREE.PerspectiveCamera(70, w/h, 1, 30000);
        this.activeCamera = this.cameraCockpit;

        const amb = new THREE.AmbientLight(0xffffff, 0.8);
        const dir = new THREE.DirectionalLight(0xffffff, 1.5);
        dir.position.set(2000, 3000, 2000);
        this.scene.add(amb, dir);

        this.terrainManager = new TerrainManager(this.scene);

        // Jet Assembly
        let dColor = 0x343A40; let dEmissive = 0x000000;
        if (skin.includes('مدريد')) dColor = 0xffffff;
        if (skin.includes('برشلونة')) { dColor = 0x000044; dEmissive = 0x330000; }

        this.jet = new THREE.Group();
        const matMatte = new THREE.MeshStandardMaterial({color: dColor, emissive: dEmissive, roughness: 0.8, metalness: 0.5});
        
        const dBody = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 16), matMatte);
        const dWing = new THREE.Mesh(new THREE.BufferGeometry(), matMatte);
        const wPts = new Float32Array([0,0,-6, 30,0,10, 0,0,6, 0,0,-6, 0,0,6, -30,0,10]);
        dWing.geometry.setAttribute('position', new THREE.BufferAttribute(wPts, 3));
        dWing.geometry.computeVertexNormals();
        this.jet.add(dBody, dWing);
        this.jet.position.set(0, 1500, 0);

        // Cockpit Internals
        this.cockpitGroup = new THREE.Group();
        this.cockpitGroup.position.set(0, 1, -4);
        const dash = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2), new THREE.MeshStandardMaterial({color: 0x111111}));
        dash.position.set(0, -1, -2);
        
        this.radarRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({color: 0x00ff66, side: THREE.DoubleSide}));
        this.radarRing.position.set(0, 0, -2.5);
        
        this.cockpitGroup.add(dash, this.radarRing);
        this.cameraCockpit.position.set(0, 2, 0);
        this.cockpitGroup.add(this.cameraCockpit);
        
        this.jet.add(this.cockpitGroup);
        this.scene.add(this.jet);

        // Ground Player
        this.player = new THREE.Group();
        const pMat = new THREE.MeshStandardMaterial({color: 0x1a1c1e, roughness: 0.9});
        const pBody = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), pMat); pBody.position.y = 2;
        const pHead = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pMat); pHead.position.y = 4.5;
        this.player.add(pBody, pHead);
        this.player.visible = false;
        this.scene.add(this.player);

        // Scenario Setup
        if (this.level === 1) {
            for (let i = 0; i < 3; i++) {
                const e = new THREE.Mesh(new THREE.BoxGeometry(40, 80, 40), new THREE.MeshLambertMaterial({color: 0x440000}));
                e.position.set((Math.random()-0.5)*3000, 0, -5000 - Math.random()*8000);
                e.position.y = getTerrainHeight(e.position.x, e.position.z) + 40;
                this.scene.add(e);
                this.targets.push({ mesh: e, hp: 100, active: true });
                
                const blip = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial({color: 0xff0000}));
                this.radarRing.add(blip);
                this.radarBlips.push(blip);
            }
            
            // Easter Egg
            const hr = new Date().getHours();
            if (hr >= 15 && hr < 17) {
                const prmd = new THREE.Mesh(new THREE.ConeGeometry(80, 180, 4), new THREE.MeshLambertMaterial({color: 0xffdd00, wireframe: true}));
                prmd.position.set((Math.random()-0.5)*4000, 0, -4000);
                prmd.position.y = getTerrainHeight(prmd.position.x, prmd.position.z) + 100;
                this.scene.add(prmd);
                this.pyramid = prmd;
            }
        }

        window.addEventListener('resize', this.onResize);
        
        this.terrainManager.update(this.jet.position);
        this.renderer.setAnimationLoop(this.animate);
    }

    private onResize = () => {
        const nw = window.innerWidth; const nh = window.innerHeight;
        this.renderer.setSize(nw, nh);
        [this.cameraCockpit, this.cameraChase, this.cameraTop, this.cameraFLIR, this.cameraPlayer].forEach(c => { c.aspect = nw/nh; c.updateProjectionMatrix(); });
    }

    public dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
    }

    public toggleCamera() {
        if (this.state === 'AIR') {
            this.camIndex = (this.camIndex + 1) % 4;
            this.sync();
        }
    }

    public triggerDismount() {
        if (this.state === 'AIR' && this.level === 1) this.state = 'LANDING';
    }

    public triggerBoarding() {
        if (this.state === 'GROUND') this.state = 'BOARDING';
    }

    public fire() {
        this.shake = 1.0; this.flashFrames = 3;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 15).rotateX(Math.PI/2), new THREE.MeshBasicMaterial({color: 0xffff00}));
        if (this.state === 'GROUND') {
            b.position.copy(this.player.position).add(new THREE.Vector3(0, 3, 0));
            b.quaternion.copy(this.player.quaternion);
        } else {
            b.position.copy(this.jet.position);
            b.quaternion.copy(this.jet.quaternion);
        }
        this.missiles.push({ mesh: b, vel: new THREE.Vector3(0, 0, -6000).applyQuaternion(b.quaternion), life: 4.0 });
        this.scene.add(b);
    }

    private initSpace() {
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = null;
        
        const sGeo = new THREE.BufferGeometry();
        const sArr = new Float32Array(3000);
        for(let i=0; i<3000; i++) sArr[i] = (Math.random()-0.5)*30000;
        sGeo.setAttribute('position', new THREE.BufferAttribute(sArr, 3));
        this.stars = new THREE.Points(sGeo, new THREE.PointsMaterial({color: 0xffffff, size: 20}));
        this.stars.position.set(0, 15000, 0);
        this.scene.add(this.stars);

        this.earth = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 32), new THREE.MeshLambertMaterial({color: 0x0055ff, emissive: 0x001133}));
        this.earth.position.set(0, 15000, -4000);
        this.scene.add(this.earth);
    }

    private sync() {
        if (!this.onSync) return;
        let tHit = 0; let tTot = this.targets.length;
        this.targets.forEach(t => { if (!t.active) tHit++; });
        
        if (tHit === tTot && tTot > 0 && this.state !== 'CINEMATIC') {
            this.state = 'CINEMATIC';
            this.activeCamera = this.cameraChase;
        }

        const camNames = ['COCKPIT_INTERNAL', 'EXTERIOR_CHASE', 'TOP_DOWN_VIEW', 'MILITARY_DRONE_FLIR'];
        this.onSync({ 
            camIndex: this.camIndex, camName: camNames[this.camIndex], 
            progress: Math.floor((tHit/tTot)*100)||0, godMode: this.godMode, state: this.state 
        });
    }

    private spawnExplosion(pos: THREE.Vector3) {
        this.shake = 2.0; this.flashFrames = 5;
        const g = new THREE.BufferGeometry(); const pts = new Float32Array(600); const vels = [];
        for(let i=0; i<600; i+=3) {
            pts[i]=pos.x; pts[i+1]=pos.y; pts[i+2]=pos.z;
            vels.push(new THREE.Vector3((Math.random()-0.5)*2, Math.random(), (Math.random()-0.5)*2).normalize().multiplyScalar(1000+Math.random()*1000));
        }
        g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const ptsMesh = new THREE.Points(g, new THREE.PointsMaterial({color: 0xffaa00, size: 40, transparent: true}));
        this.scene.add(ptsMesh);
        this.explosions.push({mesh: ptsMesh, life: 1.5, vels});
        this.sync();
    }

    private animate = () => {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        
        // Target Radar Updates
        this.targets.forEach((t, i) => {
            if (t.active && this.radarBlips[i]) {
                const dir = t.mesh.position.clone().sub(this.jet.position).normalize();
                const lDir = dir.applyQuaternion(this.jet.quaternion.clone().invert());
                this.radarBlips[i].position.set(lDir.x * 0.8, -lDir.z * 0.8, 0); 
                this.radarBlips[i].visible = true;
            } else if (this.radarBlips[i]) {
                this.radarBlips[i].visible = false;
            }
        });

        // Easter Egg
        if (this.pyramid) {
            this.pyramid.rotation.y += 2*dt;
            const dist = this.state === 'GROUND' ? this.player.position.distanceTo(this.pyramid.position) : this.jet.position.distanceTo(this.pyramid.position);
            if (dist < 200) {
                this.godMode = true; this.scene.remove(this.pyramid); this.pyramid = undefined;
                this.flashFrames = 20; if(this.onGodModeTrigger) this.onGodModeTrigger(); this.sync();
            }
        }

        // State Machine
        if (this.state === 'AIR') {
            this.player.visible = false;
            this.jet.translateZ(-1500 * dt);
            this.jet.rotation.x = this.input.y * 1.5; 
            this.jet.rotation.z = -this.input.x * 1.5; 
            this.jet.rotation.y -= this.input.x * 1.5 * dt; 
            
            const minH = getTerrainHeight(this.jet.position.x, this.jet.position.z) + 100;
            if (this.jet.position.y < minH) this.jet.position.y = minH;
            this.terrainManager.update(this.jet.position);
            
            if (this.camIndex === 0) {
                this.activeCamera = this.cameraCockpit;
            } else if (this.camIndex === 1) {
                this.activeCamera = this.cameraChase;
                this.cameraChase.position.copy(this.jet.position).add(new THREE.Vector3(0, 50, 200).applyQuaternion(this.jet.quaternion));
                this.cameraChase.lookAt(this.jet.position);
            } else if (this.camIndex === 2) {
                this.activeCamera = this.cameraTop;
                this.cameraTop.position.copy(this.jet.position).add(new THREE.Vector3(0, 1500, 0));
                this.cameraTop.lookAt(this.jet.position);
            } else {
                this.activeCamera = this.cameraFLIR;
                this.cameraFLIR.position.copy(this.jet.position).add(new THREE.Vector3(0, -20, -50));
                this.cameraFLIR.rotation.copy(this.jet.rotation);
                this.cameraFLIR.rotateX(-0.1);
            }

        } else if (this.state === 'LANDING') {
            this.activeCamera = this.cameraChase;
            this.cameraChase.position.copy(this.jet.position).add(new THREE.Vector3(0, 50, 200));
            this.cameraChase.lookAt(this.jet.position);
            
            const gY = getTerrainHeight(this.jet.position.x, this.jet.position.z) + 15;
            this.jet.position.y += (gY - this.jet.position.y) * 2 * dt;
            this.jet.rotation.x *= 0.9; this.jet.rotation.z *= 0.9;
            if (Math.abs(this.jet.position.y - gY) < 2) {
                this.state = 'GROUND';
                this.player.position.copy(this.jet.position);
                this.player.position.z -= 40;
                this.player.visible = true;
                this.sync();
            }
        } else if (this.state === 'BOARDING') {
            this.activeCamera = this.cameraChase;
            const tDir = this.jet.position.clone().sub(this.player.position);
            tDir.y = 0;
            if (tDir.length() < 10) {
                this.state = 'AIR';
                this.sync();
            } else {
                tDir.normalize();
                this.player.position.addScaledVector(tDir, 100 * dt);
                this.player.position.y = getTerrainHeight(this.player.position.x, this.player.position.z);
                this.cameraChase.position.copy(this.player.position).add(new THREE.Vector3(0, 20, 50));
                this.cameraChase.lookAt(this.player.position);
            }
        } else if (this.state === 'GROUND') {
            const spd = this.crouching ? 40 : (this.sprinting ? 200 : 80);
            this.player.rotation.y -= this.input.x * 2.5 * dt;
            this.player.translateZ(this.input.y * spd * dt); 
            this.player.position.y = getTerrainHeight(this.player.position.x, this.player.position.z);
            
            this.activeCamera = this.cameraPlayer;
            const off = new THREE.Vector3(0, this.crouching ? 3 : 6, 25).applyQuaternion(this.player.quaternion);
            this.cameraPlayer.position.copy(this.player.position).add(off);
            this.cameraPlayer.lookAt(this.player.position);
            this.terrainManager.update(this.player.position);
        } else if (this.state === 'CINEMATIC') {
            this.cinematicTime += dt;
            if (this.cinematicTime < 4) {
                this.jet.rotation.x += (Math.PI/2 - this.jet.rotation.x) * dt; 
                this.jet.position.y += 2500 * dt;
                this.jet.position.z -= 1000 * dt;
                this.cameraChase.position.copy(this.jet.position).add(new THREE.Vector3(0, -50, 300).applyQuaternion(this.jet.quaternion));
                this.cameraChase.lookAt(this.jet.position);
            } else {
                if (!this.spaceInit) { this.initSpace(); this.spaceInit = true; this.cinematicTime = 4; }
                const oT = (this.cinematicTime - 4) * 0.4;
                this.jet.position.x = this.earth!.position.x + Math.sin(oT) * 3000;
                this.jet.position.z = this.earth!.position.z + Math.cos(oT) * 3000;
                this.jet.position.y = 15000;
                this.jet.lookAt(this.earth!.position);
                this.jet.rotateY(Math.PI/2);
                
                this.cameraChase.position.copy(this.jet.position).add(new THREE.Vector3(500, 200, 500));
                this.cameraChase.lookAt(this.jet.position);

                if (oT > Math.PI * 2.5 && this.onVictory) {
                    this.onVictory(this.score);
                    this.onVictory = undefined;
                }
            }
        }

        // Projectiles
        for (let i=this.missiles.length-1; i>=0; i--) {
            let m = this.missiles[i];
            m.life -= dt; m.mesh.position.addScaledVector(m.vel, dt);
            let hit = false;

            if (this.pyramid && m.mesh.position.distanceTo(this.pyramid.position) < 200) {
                this.godMode = true; this.scene.remove(this.pyramid); this.pyramid = undefined;
                this.flashFrames = 20; if(this.onGodModeTrigger) this.onGodModeTrigger(); this.sync();
            }

            if (this.state !== 'CINEMATIC' && m.mesh.position.y < getTerrainHeight(m.mesh.position.x, m.mesh.position.z)) hit = true;
            
            if (!hit) {
                for (let j=0; j<this.targets.length; j++) {
                    let tr = this.targets[j];
                    if (tr.active && tr.mesh.position.distanceTo(m.mesh.position) < 150) {
                        tr.hp -= this.godMode ? 99999 : 50; hit = true;
                        if (tr.hp <= 0) { 
                            tr.active = false; tr.mesh.visible = false; 
                            this.spawnExplosion(tr.mesh.position); 
                            this.score += 1000;
                        }
                        break;
                    }
                }
            }
            if(hit || m.life<=0) { this.scene.remove(m.mesh); this.missiles.splice(i,1); if(hit) this.spawnExplosion(m.mesh.position);}
        }

        // Explosions
        for (let i=this.explosions.length-1; i>=0; i--) {
            let ex = this.explosions[i]; ex.life -= dt;
            const pArr = ex.mesh.geometry.attributes.position.array as Float32Array;
            for(let j=0; j<ex.vels.length; j++) {
                pArr[j*3] += ex.vels[j].x*dt; pArr[j*3+1] += ex.vels[j].y*dt; pArr[j*3+2] += ex.vels[j].z*dt;
            }
            ex.mesh.geometry.attributes.position.needsUpdate = true;
            (ex.mesh.material as THREE.PointsMaterial).opacity = ex.life;
            if(ex.life<=0) { this.scene.remove(ex.mesh); this.explosions.splice(i,1); }
        }

        let sx = 0; let sy = 0;
        if (this.shake > 0) {
            this.shake -= dt*5; if(this.shake < 0) this.shake = 0;
            sx = (Math.random()-0.5)*30*this.shake; sy = (Math.random()-0.5)*30*this.shake;
            this.activeCamera.position.x += sx; this.activeCamera.position.y += sy;
        }

        // FLIR and Strobe Overrides
        if (this.flashFrames > 0) {
            this.scene.background = new THREE.Color(this.flashFrames % 2 === 0 ? 0xffffff : 0xaa0000);
            this.scene.overrideMaterial = null;
            this.flashFrames--;
        } else if (this.camIndex === 3 && this.state === 'AIR') {
            this.scene.background = new THREE.Color(0x111111);
            this.scene.overrideMaterial = new THREE.MeshBasicMaterial({color: 0xcccccc});
            this.scene.fog = null;
        } else {
            this.scene.background = this.spaceInit ? new THREE.Color(0x000000) : new THREE.Color(0x87CEEB);
            this.scene.overrideMaterial = null;
            this.scene.fog = this.spaceInit ? null : new THREE.FogExp2(0x87CEEB, 0.0002);
        }

        this.renderer.render(this.scene, this.activeCamera);
        
        if (this.shake > 0) { this.activeCamera.position.x -= sx; this.activeCamera.position.y -= sy; }
    };
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
            <div ref={stick} className="w-10 h-10 rounded-full border-2 bg-white/40 transition-transform duration-75 shadow-[0_0_15px_#00FF66]" style={{borderColor: C_TEXT}} />
        </div>
    );
}

// --- APP COMPONENT ---
export default function App() {
    const [orientWarning, setOrientWarning] = useState(false);
    useEffect(() => {
        const chk = () => setOrientWarning(window.innerHeight > window.innerWidth);
        chk(); window.addEventListener('resize', chk);
        return () => window.removeEventListener('resize', chk);
    }, []);

    const [state, setState] = useState<'MAP' | 'GAME' | 'VICTORY'>('MAP');
    const [tab, setTab] = useState<'OPS' | 'HANGAR' | 'LAN'>('OPS');
    const [save, setSave] = useSaveData();
    const [selLvl, setSelLvl] = useState(1);
    
    // Audio 
    const [audio] = useState(() => typeof window !== 'undefined' ? new Audio('./audio/battle_hype.mp3') : null);
    const [audioPlay, setAudioPlay] = useState(false);
    useEffect(() => {
        if(!audio) return;
        audio.loop = true;
        if(audioPlay) audio.play().catch(()=>{}); else audio.pause();
    }, [audioPlay, audio]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalSim | null>(null);
    const [hud, setHud] = useState<any>({ camIndex: 0, camName: 'COCKPIT_INTERNAL', progress: 0, godMode: false, state: 'AIR' });
    const [godMsg, setGodMsg] = useState(false);
    
    const LEVELS = [
        { id: 1, n: 'الغارة الجبلية النهارية' },
        { id: 2, n: 'القطاع البحري: المدمرات' },
        { id: 3, n: 'خطوط الإمداد العسكرية' }
    ];

    const MOCK_LAN = useMemo(() => {
        let players = [
            { name: "صقر_شرعب", score: 14500 },
            { name: "النمر_التكتيكي", score: 12200 },
            { name: "حنرال_المدمره", score: 9800 },
            { name: "أنت (محلي)", score: save.highScore }
        ];
        return players.sort((a,b) => b.score - a.score);
    }, [save.highScore]);

    useEffect(() => {
        if (state === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalSim(canvasRef.current, selLvl, save.activeSkin);
            engineRef.current.onSync = (d) => setHud(h => ({...h, ...d}));
            engineRef.current.onGodModeTrigger = () => { setGodMsg(true); setTimeout(()=>setGodMsg(false), 4000); };
            engineRef.current.onVictory = (score) => {
                setSave(s => ({...s, highScore: Math.max(s.highScore, score), unlockedLevel: Math.max(s.unlockedLevel, selLvl+1), credits: s.credits + 500 }));
                setState('VICTORY');
            };
        }
        return () => { if (state !== 'GAME' && engineRef.current) { engineRef.current.dispose(); engineRef.current = null; } }
    }, [state, selLvl, save.activeSkin, setSave]);

    if (orientWarning) {
        return (
            <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-8 text-center" style={{background: '#0a0a0a', direction: 'rtl'}}>
                <div className="w-20 h-20 border-8 border-red-600 border-t-transparent rounded-full animate-spin mb-8" />
                <h1 className="text-4xl font-black text-red-600 tracking-widest leading-loose drop-shadow-[0_0_15px_#ff0000]">
                    تنبيه أمني: يرجى تدوير الشاشة للوضع الأفقي للتشغيل
                </h1>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 overflow-hidden font-mono select-none" dir="rtl" style={{backgroundColor: C_BG, color: C_TEXT, touchAction: 'none'}}>
            <style>
            {`
                @keyframes crt-scanlines { 0% { background-position: 0 0; } 100% { background-position: 0 4px; } }
                .scanline-overlay { animation: crt-scanlines 0.2s linear infinite; }
            `}
            </style>

            <div className="absolute inset-0 pointer-events-none z-[900] scanline-overlay" style={scanlineStyles} />

            {state === 'MAP' && (
                <div className="absolute inset-0 flex flex-col p-6 z-10" style={{backgroundColor: C_BG}}>
                    <div className="flex justify-between items-end mb-8 border-b pb-4" style={{borderColor: C_BORDER}}>
                        <div>
                            <h1 className="text-3xl font-black tracking-widest uppercase mb-2 text-white">القيادة الإستراتيجية العليا</h1>
                            <div className="flex gap-4 pointer-events-auto">
                                <button onClick={()=>setTab('OPS')} className={`px-4 py-2 border font-bold ${tab==='OPS'?'bg-white/10 text-white':''}`} style={{borderColor: C_BORDER}}>العمليات التكتيكية</button>
                                <button onClick={()=>setTab('HANGAR')} className={`px-4 py-2 border font-bold ${tab==='HANGAR'?'bg-white/10 text-white':''}`} style={{borderColor: C_BORDER}}>المستودع والدروع</button>
                                <button onClick={()=>setTab('LAN')} className={`px-4 py-2 border font-bold ${tab==='LAN'?'bg-white/10 text-white':''}`} style={{borderColor: C_BORDER}}>بطولة الحارة (Ping: 0ms)</button>
                            </div>
                        </div>
                    </div>
                    
                    {tab === 'OPS' && (
                        <div className="flex-1 flex gap-6 overflow-x-auto pb-4 items-center justify-center pointer-events-auto">
                            {LEVELS.map((l) => {
                                const locked = l.id > save.unlockedLevel;
                                return (
                                    <div key={l.id} className="w-[24rem] h-[26rem] border flex flex-col transition-transform hover:scale-105" style={{borderColor: locked ? '#222' : C_BORDER, background: C_PANEL}}>
                                        <div className="h-48 border-b relative flex items-center justify-center overflow-hidden" style={{borderColor: C_BORDER, background: locked?'#111':'#1A2C20'}}>
                                            {locked ? <LockIcon /> : <TargetIcon />}
                                        </div>
                                        <div className="p-6 flex-1 flex flex-col justify-between">
                                            <h3 className="text-2xl font-bold" style={{color: locked ? '#555' : 'white'}}>{l.n}</h3>
                                            <button onClick={() => { setSelLvl(l.id); setState('GAME'); }} disabled={locked} className="w-full py-4 font-bold tracking-widest border transition-colors uppercase" style={{borderColor: C_BORDER, color: locked ? '#555' : C_TEXT}}>
                                                {locked ? 'مقفل' : 'تأكيد النشر التكتيكي'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {tab === 'HANGAR' && (
                        <div className="flex-1 overflow-auto grid grid-cols-2 gap-6 p-4 pointer-events-auto">
                            <div className="border border-green-700 bg-[#001a00] p-6 flex flex-col gap-4">
                                <h2 className="text-2xl font-black text-[#00ff66] border-b border-green-800 pb-2">سرب الطائرات</h2>
                                <button onClick={()=>setSave(s=>({...s, activeSkin: 'default'}))} className={`px-4 py-2 border ${save.activeSkin==='default'?'bg-green-900 text-white':'border-green-800'} text-[#00ff66]`}>B-2 Stealth (قياسي)</button>
                            </div>
                            <div className="border border-yellow-700 bg-[#1a1500] p-6 flex flex-col gap-4">
                                <h2 className="text-2xl font-black text-yellow-500 border-b border-yellow-800 pb-2">سوق النخبة الحصري (FOMO)</h2>
                                {[{id:'حزمة الملكي - ريال مدريد الكونية', col:'#ffdd00'}, {id:'كتيبة النخبة - برشلونة التكتيكية', col:'#ff2255'}].map(ps => (
                                    <div key={ps.id} className="border border-yellow-800/50 p-4 flex justify-between items-center bg-black/50">
                                        <div className="font-bold text-lg" style={{color: ps.col}}>{ps.id}</div>
                                        <button onClick={()=>setSave(s=>({...s, activeSkin: ps.id}))} className={`px-4 py-2 border border-yellow-500 ${save.activeSkin === ps.id ? 'bg-yellow-900 text-white' : 'bg-transparent'} text-yellow-500`}>
                                            {save.activeSkin === ps.id ? 'مُجهز' : 'تجهيز'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {tab === 'LAN' && (
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <div className="w-full max-w-2xl border bg-black/80 p-8" style={{borderColor: C_BORDER}}>
                                <h2 className="text-3xl font-black text-center mb-8 border-b pb-4 text-white" style={{borderColor: C_BORDER}}>لوحة شرف الأبطال المحلية</h2>
                                {MOCK_LAN.map((p, i) => (
                                    <div key={i} className={`flex justify-between p-4 mb-2 border ${p.name.includes('أنت') ? 'bg-[#003311] border-[#00FF66] font-black' : 'bg-[#2C3034] border-[#3F444A]'}`}>
                                        <span className={p.name.includes('أنت')?'text-white':''}>{p.name}</span>
                                        <span>{p.score.toLocaleString()} PTS</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {state === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
                    
                    {godMsg && (
                        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 bg-yellow-500 text-black px-12 py-6 font-black text-4xl z-50 animate-pulse tracking-tighter shadow-[0_0_50px_rgba(255,200,0,0.5)] pointer-events-none">
                            تنبيه: أنت الآن زعيم الكون العسكري
                        </div>
                    )}

                    {hud.state === 'CINEMATIC' && (
                        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 text-white px-12 py-6 font-black text-4xl z-50 animate-bounce tracking-widest drop-shadow-[0_0_20px_#00ff66] pointer-events-none">
                            MILITARY OVERRIDE
                        </div>
                    )}

                    {hud.state !== 'CINEMATIC' && (
                        <div className="absolute inset-0 pointer-events-none flex justify-between p-6 z-10" style={{ filter: hud.camIndex === 3 && hud.state === 'AIR' ? 'grayscale(100%) contrast(1.5)' : '' }}>
                            
                            <div className="flex flex-col gap-2">
                                <div className="border px-4 py-2 font-bold tracking-widest text-sm flex gap-4 backdrop-blur-sm shadow-xl" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    <span className={hud.godMode ? 'text-yellow-500':'text-[#00FF66]'}>SYS: {hud.camName}</span>
                                </div>
                                <div className="border px-4 py-2 font-bold text-xs flex flex-col gap-1 backdrop-blur-sm w-64 uppercase" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    <span>HVT Cleared: {hud.progress}%</span>
                                    <div className="w-full h-1 bg-black"><div className="h-full bg-[#00FF66] transition-all" style={{width: `${hud.progress}%`}}/></div>
                                </div>
                            </div>
                            
                            <div className="flex gap-4 pointer-events-auto items-start">
                                <button onClick={() => setAudioPlay(!audioPlay)} className="border p-3 hover:bg-white/10 text-white" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                    <MusicIcon />
                                </button>
                                {hud.state === 'AIR' && (
                                    <>
                                        <button onClick={() => engineRef.current?.toggleCamera()} className="border p-3 hover:bg-white/10 text-white" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                            <CameraIcon />
                                        </button>
                                        {selLvl === 1 && (
                                            <button onClick={() => engineRef.current?.triggerDismount()} className="border p-3 hover:bg-white/10 text-white" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                                <DismountIcon />
                                            </button>
                                        )}
                                    </>
                                )}
                                {hud.state === 'GROUND' && (
                                    <button onClick={() => engineRef.current?.triggerBoarding()} className="border p-3 hover:bg-white/10 text-white" style={{borderColor: C_BORDER, background: C_PANEL}}>
                                        <JetIcon />
                                    </button>
                                )}
                                <button onClick={() => setState('MAP')} className="border px-6 py-3 font-bold tracking-widest text-red-500 hover:bg-red-900/50 uppercase" style={{borderColor: '#522', background: '#211'}}>
                                    Abort
                                </button>
                            </div>

                            <div className="absolute inset-0 flex items-center justify-center opacity-70 pointer-events-none">
                                <div className="w-48 h-48 relative">
                                    <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                    <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2" style={{borderColor: hud.godMode?'#ffdd00':C_TEXT}} />
                                    <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-red-500 rounded-full -translate-x-1/2 -translate-y-1/2" />
                                </div>
                            </div>

                            <div className="absolute bottom-6 left-6 pointer-events-auto">
                                <Joystick onMove={(x, y) => { if (engineRef.current) { engineRef.current.input.x = x; engineRef.current.input.y = y; } }} />
                            </div>

                            {hud.state === 'GROUND' && (
                                <div className="absolute bottom-6 left-[200px] flex gap-4 pointer-events-auto">
                                    <button onPointerDown={() => engineRef.current && (engineRef.current.sprinting = true)} onPointerUp={() => engineRef.current && (engineRef.current.sprinting = false)} className="border px-6 py-2 bg-[#2C3034] text-white font-bold select-none text-xl" style={{borderColor: C_BORDER}}>جري</button>
                                    <button onPointerDown={() => engineRef.current && (engineRef.current.crouching = true)} onPointerUp={() => engineRef.current && (engineRef.current.crouching = false)} className="border px-6 py-2 bg-[#2C3034] text-white font-bold select-none text-xl" style={{borderColor: C_BORDER}}>جلوس</button>
                                </div>
                            )}

                            <div className="absolute bottom-6 right-6 flex flex-col items-center gap-4 pointer-events-auto">
                                <div className="border border-red-900 bg-black/80 px-8 py-2 font-bold text-red-500 tracking-widest text-sm uppercase">Hellfire Core</div>
                                <button onPointerDown={(e) => { e.stopPropagation(); engineRef.current?.fire(); }} 
                                        className="w-28 h-28 rounded-full border-[4px] border-[#3F444A] bg-[#cc0000] shadow-[0_0_0_2px_#1A1C1E] active:scale-95 active:bg-[#ff0000] transition-all flex items-center justify-center outline-none">
                                    <TargetIcon />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {state === 'VICTORY' && (
                <div className="absolute inset-0 backdrop-blur-2xl flex flex-col items-center justify-center z-50 p-8" style={{background: 'rgba(26, 28, 30, 0.95)'}}>
                    <div className="border-4 p-16 flex flex-col items-center text-center max-w-3xl w-full" style={{borderColor: '#00FF66', background: C_PANEL}}>
                        <TargetIcon />
                        <h2 className="text-5xl font-black mt-8 mb-4 tracking-widest text-white leading-loose">تم تطهير القطاع - النصر العسكري محقق</h2>
                        <button onClick={()=>setState('MAP')} className="w-full py-6 mt-12 text-2xl font-black tracking-widest border border-white bg-white text-black hover:bg-gray-300 transition-colors uppercase">
                            العودة للقيادة
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
