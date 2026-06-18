import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';

// ============================================================================
// CONSTANTS & ICONS
// ============================================================================

const C_PANEL = 'rgba(12, 14, 16, 0.85)';
const C_BORDER = '#3F444A';
const C_NEON = '#00FF66';
const C_HOT = '#FF0055';

const IconLock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
const IconWifi = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>;
const IconMusic = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
const IconHeroDown = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>;
const IconCam = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const IconTarget = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full"><circle cx="12" cy="12" r="10"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>;

const LEVELS = Array.from({length: 15}, (_, i) => ({
    id: i + 1,
    name: i === 0 ? "الغارة النهارية الأولى" : (i === 14 ? "مسار النهاية الكوني" : `دورة القطاع المتقدمة ${i+1}`)
}));

// ============================================================================
// THREE.JS AAA ENGINE
// ============================================================================

function createYemenVestTexture(name: string) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#CE1126'; ctx.fillRect(0,0,512,170);   // Red
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,170,512,172); // White
    ctx.fillStyle = '#000000'; ctx.fillRect(0,342,512,170); // Black
    
    ctx.fillStyle = '#000000';
    ctx.font = '900 45px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('تَنكِيل-SGMW', 256, 215);
    ctx.font = 'bold 35px sans-serif';
    ctx.fillText(name || 'OPERATOR', 256, 260); // profile name inside
    return new THREE.CanvasTexture(c);
}

class PostProcessor {
    target: THREE.WebGLRenderTarget;
    camera: THREE.OrthographicCamera;
    scene: THREE.Scene;
    quad: THREE.Mesh;
    
    constructor(w: number, h: number) {
        this.target = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new THREE.ShaderMaterial({
                uniforms: { tDiff: { value: this.target.texture }, isFLIR: { value: 0.0 } },
                vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
                fragmentShader: `
                    uniform sampler2D tDiff; uniform float isFLIR; varying vec2 vUv;
                    void main(){
                        vec4 tex = texture2D(tDiff, vUv);
                        if(isFLIR > 0.5) {
                            float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
                            float scan = sin(vUv.y * 1000.0) * 0.04;
                            gl_FragColor = vec4(vec3(lum) + vec3(scan), 1.0);
                        } else { gl_FragColor = tex; }
                    }
                `,
                depthWrite: false, depthTest: false
            })
        );
        this.scene.add(this.quad);
    }
    resize(w: number, h: number) { this.target.setSize(w, h); }
}

class TacticalEngine {
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public postProcess: PostProcessor;
    
    private clock = new THREE.Clock();
    public state: 'AIR' | 'BOARDING' | 'EXTRACT' = 'AIR';
    public heroMode: 'AIR' | 'GROUND' = 'AIR';
    public camMode: 'COCKPIT' | 'CHASE' | 'DRONE' = 'CHASE';
    
    // Physics
    public input = { x: 0, y: 0 };
    private airSpeed = 600; private airPitch = 0; private airRoll = 0;
    public isSprinting = false; public isCrouching = false;
    private isRolling = false; private rollTime = 0; private rollDir = 1;
    
    // Entities
    public jet: THREE.Group;
    public player: THREE.Group;
    public cockpitUI: THREE.Group;
    public gyro!: THREE.Mesh;
    public radarBlips: THREE.Mesh[] = [];
    public targets: { mesh: THREE.Mesh, hp: number, active: boolean, box: THREE.BoxHelper }[] = [];
    public missiles: { mesh: THREE.Mesh, vel: THREE.Vector3, life: number }[] = [];
    public explosions: { ring: THREE.Mesh, parts: THREE.Points, life: number, vels: THREE.Vector3[] }[] = [];
    
    // Scene Assets
    private terrain!: THREE.Mesh;
    private earthGroup?: THREE.Group;
    private spaceInit = false;
    private cinematicTime = 0;
    private flashFrames = 0;
    private shakeMag = 0;

    // Callbacks
    public onSync?: (d: any) => void;
    public onBoardComplete?: () => void;
    public onVictory?: () => void;

    constructor(canvas: HTMLCanvasElement, levelId: number) {
        const w = window.innerWidth; const h = window.innerHeight;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.0001);
        
        this.camera = new THREE.PerspectiveCamera(60, w/h, 1, 80000);
        this.postProcess = new PostProcessor(w, h);

        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(3000, 5000, 2000);
        this.scene.add(amb, dir);

        this.buildTerrain();
        this.buildJet();
        this.buildHero();

        // Level Targets
        const tCount = levelId === 1 ? 1 : 4; // Level 1 is easy (1 target)
        for(let i=0; i<tCount; i++) {
            const e = new THREE.Mesh(new THREE.BoxGeometry(100, 150, 100), new THREE.MeshLambertMaterial({color: 0x110000, emissive: 0x330000}));
            e.position.set((Math.random()-0.5)*8000, 0, -4000 - Math.random()*8000);
            e.position.y = this.getHeight(e.position.x, e.position.z) + 75;
            this.scene.add(e);
            
            const box = new THREE.BoxHelper(e, new THREE.Color(C_NEON));
            box.visible = false;
            this.scene.add(box);
            
            this.targets.push({ mesh: e, hp: levelId===1 ? 1 : 100, active: true, box });
        }

        window.addEventListener('resize', this.onResize);
        this.renderer.setAnimationLoop(this.animate);
    }

    private onResize = () => {
        const w = window.innerWidth; const h = window.innerHeight;
        this.renderer.setSize(w, h);
        this.postProcess.resize(w, h);
        this.camera.aspect = w/h;
        this.camera.updateProjectionMatrix();
    }

    public dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
    }

    private getHeight(x: number, z: number) {
        return Math.sin(x*0.002)*Math.cos(z*0.002)*300 + Math.sin(x*0.01 + z*0.01)*50;
    }

    private buildTerrain() {
        const g = new THREE.PlaneGeometry(60000, 60000, 128, 128); g.rotateX(-Math.PI/2);
        const pos = g.attributes.position;
        for(let i=0; i<pos.count; i++) pos.setY(i, this.getHeight(pos.getX(i), pos.getZ(i)));
        g.computeVertexNormals();
        this.terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({color: 0x1A281A, flatShading:true}));
        this.scene.add(this.terrain);
    }

    private buildJet() {
        this.jet = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({color: 0x1A1C20, roughness: 0.6, metalness: 0.8});
        const body = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 20), mat);
        const wingGeo = new THREE.BufferGeometry();
        wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,-8, 30,0,10, 0,0,8,  0,0,-8, 0,0,8, -30,0,10]), 3));
        wingGeo.computeVertexNormals();
        this.jet.add(body, new THREE.Mesh(wingGeo, mat));
        this.jet.position.set(0, 1500, 0);

        // Cockpit Internals
        this.cockpitUI = new THREE.Group();
        this.cockpitUI.position.set(0, 0, -4);
        const dash = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 2), new THREE.MeshStandardMaterial({color: 0x050505})); dash.position.set(0, -1.5, 0);
        
        this.gyro = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), new THREE.MeshBasicMaterial({color: C_NEON, wireframe:true}));
        this.gyro.position.set(-1.2, -0.2, 0); this.gyro.rotation.x = Math.PI/2;
        
        const rArea = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({color: 0x050505}));
        rArea.position.set(1.2, -0.2, 0.05);
        rArea.add(new THREE.Mesh(new THREE.RingGeometry(0.65, 0.7, 32), new THREE.MeshBasicMaterial({color: C_NEON})));
        for(let i=0; i<4; i++) {
            const blip = new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), new THREE.MeshBasicMaterial({color: C_HOT}));
            rArea.add(blip); this.radarBlips.push(blip);
        }

        this.cockpitUI.add(dash, this.gyro, rArea);
        this.jet.add(this.cockpitUI);
        this.scene.add(this.jet);
    }

    private buildHero() {
        this.player = new THREE.Group();
        const vTex = createYemenVestTexture('OPERATOR');
        const torso = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.5, 1.5), new THREE.MeshStandardMaterial({map: vTex, roughness: 0.9})); torso.position.y = 3;
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.4), new THREE.MeshStandardMaterial({color: 0x111111})); head.position.y = 5.6;
        const mask = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.4, 0.2), new THREE.MeshBasicMaterial({color: C_NEON})); mask.position.set(0, 5.6, 0.7);
        this.player.add(torso, head, mask);
        this.player.visible = false;
        this.scene.add(this.player);
    }

    private initSpace() {
        this.earthGroup = new THREE.Group();
        const eMesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 64, 64), new THREE.MeshStandardMaterial({color: 0x0033aa, emissive: 0x001133}));
        eMesh.position.set(0, 15000, -8000);
        this.earthGroup.add(eMesh);
        
        const sGeo = new THREE.BufferGeometry(); const sPos = new Float32Array(3000*3);
        for(let i=0; i<3000*3; i++) sPos[i] = (Math.random()-0.5)*60000;
        sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
        this.earthGroup.add(new THREE.Points(sGeo, new THREE.PointsMaterial({color: 0xFFFFFF, size: 50})));
        this.earthGroup.position.set(0, 20000, 0);
        this.scene.add(this.earthGroup);
    }

    public triggerBoarding(cb: ()=>void) {
        this.state = 'BOARDING';
        this.onBoardComplete = cb;
    }

    public triggerRoll() {
        if (this.heroMode === 'GROUND' && !this.isRolling) {
            this.isRolling = true; this.rollTime = 0.4;
            this.rollDir = this.input.x < 0 ? 1 : -1;
        }
    }

    public fire() {
        this.shakeMag = 1.0; this.flashFrames = 1;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 40).rotateX(Math.PI/2), new THREE.MeshBasicMaterial({color: C_NEON}));
        const src = this.heroMode === 'AIR' ? this.jet : this.player;
        b.position.copy(src.position).add(new THREE.Vector3(0, this.heroMode==='AIR'?0:5, 0));
        b.quaternion.copy(src.quaternion);
        this.missiles.push({ mesh: b, vel: new THREE.Vector3(0,0,-8000).applyQuaternion(b.quaternion), life: 4.0 });
        this.scene.add(b);
    }

    private triggerExplosion(pos: THREE.Vector3) {
        this.shakeMag = 4.0; this.flashFrames = 3;
        const ring = new THREE.Mesh(new THREE.RingGeometry(1, 10, 32), new THREE.MeshBasicMaterial({color: C_HOT, transparent: true, side: THREE.DoubleSide}));
        ring.position.copy(pos); this.scene.add(ring);

        const pGeo = new THREE.BufferGeometry(); const pArr = new Float32Array(500*3); const vels = [];
        for(let i=0; i<500; i++) {
            pArr[i*3]=pos.x; pArr[i*3+1]=pos.y; pArr[i*3+2]=pos.z;
            vels.push(new THREE.Vector3((Math.random()-0.5)*2, Math.random()*2, (Math.random()-0.5)*2).normalize().multiplyScalar(800 + Math.random()*800));
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
        const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({color: C_NEON, size: 40, transparent: true, blending: THREE.AdditiveBlending}));
        this.scene.add(parts);

        this.explosions.push({ring, parts, life: 2.0, vels});
    }

    private animate = () => {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        let rem = 0; this.targets.forEach(t => { if(t.active) rem++; });

        if (this.onSync) this.onSync({ progress: Math.floor(((this.targets.length-rem)/this.targets.length)*100), cam: this.camMode });

        // Galactic Win Loop Check
        if (rem === 0 && this.state === 'AIR' && this.heroMode === 'AIR') {
            this.state = 'EXTRACT'; this.camMode = 'CHASE';
        }

        // --- Cockpit Telemetry ---
        this.gyro.rotation.z = -this.airRoll; this.gyro.rotation.x = Math.PI/2 + this.airPitch;
        this.targets.forEach((tar, i) => {
            if (tar.active && this.radarBlips[i]) {
                let rp = tar.mesh.position.clone().sub(this.jet.position).applyQuaternion(this.jet.quaternion.clone().invert());
                rp.normalize().multiplyScalar(0.6);
                this.radarBlips[i].position.set(rp.x, -rp.z, 0.01);
                this.radarBlips[i].visible = true;
            } else if (this.radarBlips[i]) { this.radarBlips[i].visible = false; }
            
            tar.box.visible = (this.camMode === 'DRONE' && tar.active);
            if (tar.active) tar.box.update();
        });

        // --- Physics Logic ---
        if (this.state === 'AIR') {
            if (this.heroMode === 'AIR') {
                if(this.input.x===0) this.airRoll = THREE.MathUtils.lerp(this.airRoll, 0, 0.15); // Strict damping
                else { this.airRoll += this.input.x * dt * 2.5; this.airRoll = THREE.MathUtils.clamp(this.airRoll, -Math.PI/3, Math.PI/3); }
                if(this.input.y===0) this.airPitch = THREE.MathUtils.lerp(this.airPitch, 0, 0.15);
                else { this.airPitch += this.input.y * dt * 2.5; this.airPitch = THREE.MathUtils.clamp(this.airPitch, -Math.PI/3, Math.PI/3); }

                this.jet.rotation.x = this.airPitch; this.jet.rotation.z = -this.airRoll; this.jet.rotation.y -= this.airRoll * dt * 1.5;
                this.jet.translateZ(-this.airSpeed * dt);
                
                const gY = this.getHeight(this.jet.position.x, this.jet.position.z) + 150;
                if(this.jet.position.y < gY) { this.jet.position.y = THREE.MathUtils.lerp(this.jet.position.y, gY, 0.1); this.airPitch = Math.max(0, this.airPitch); }
            } else {
                this.player.scale.y = THREE.MathUtils.lerp(this.player.scale.y, this.isCrouching ? 0.5 : 1.0, 0.2);
                if (this.isRolling) {
                    this.rollTime -= dt; this.player.translateX(this.rollDir * 1200 * dt);
                    if(this.rollTime <= 0) this.isRolling = false;
                } else {
                    const spd = this.isSprinting ? 400 : this.isCrouching ? 80 : 150;
                    this.player.rotation.y -= this.input.x * 3.5 * dt;
                    this.player.translateZ(this.input.y * spd * dt);
                }
                this.player.position.y = this.getHeight(this.player.position.x, this.player.position.z);
            }
        } else if (this.state === 'BOARDING') {
            const dir = this.jet.position.clone().sub(this.player.position); dir.y = 0;
            if (dir.length() < 20) {
                if(this.onBoardComplete) { this.onBoardComplete(); this.onBoardComplete = undefined; }
                this.state = 'AIR';
            } else {
                dir.normalize(); this.player.position.addScaledVector(dir, 500 * dt);
                this.player.lookAt(this.player.position.clone().add(dir));
                this.player.position.y = this.getHeight(this.player.position.x, this.player.position.z);
            }
        } else if (this.state === 'EXTRACT') {
            this.cinematicTime += dt;
            this.airPitch = THREE.MathUtils.lerp(this.airPitch, Math.PI/4, 0.05);
            this.airSpeed = THREE.MathUtils.lerp(this.airSpeed, 12000, 0.02);
            this.jet.rotation.x = this.airPitch; this.jet.rotation.z = 0; this.jet.translateZ(-this.airSpeed * dt);
            
            if (this.jet.position.y > 6000 && !this.spaceInit) { this.initSpace(); this.spaceInit = true; }
            if (this.cinematicTime > 6) {
                const orbT = (this.cinematicTime - 6) * 0.4;
                this.jet.position.x = this.earthGroup!.position.x + Math.sin(orbT)*10000;
                this.jet.position.z = this.earthGroup!.position.z + Math.cos(orbT)*10000;
                this.jet.position.y = 35000;
                this.jet.lookAt(this.earthGroup!.position); this.jet.rotateY(Math.PI/2);
                if (orbT > Math.PI*2 && this.onVictory) { this.onVictory(); this.onVictory = undefined; }
            }
        }

        // --- Camera Matrix ---
        const aEnt = (this.state === 'BOARDING' || this.heroMode === 'GROUND') ? this.player : this.jet;
        
        if (this.camMode === 'DRONE') {
            this.camera.position.copy(aEnt.position).add(new THREE.Vector3(0, 2500, 0));
            this.camera.lookAt(aEnt.position);
            this.postProcess.quad.material.uniforms.isFLIR.value = 1.0;
        } else {
            this.postProcess.quad.material.uniforms.isFLIR.value = 0.0;
            if (this.camMode === 'COCKPIT' && this.heroMode === 'AIR' && this.state !== 'EXTRACT') {
                const off = new THREE.Vector3(0, 2, -2).applyMatrix4(this.jet.matrixWorld);
                this.camera.position.lerp(off, 0.5); this.camera.quaternion.copy(this.jet.quaternion);
            } else {
                const off = this.heroMode === 'GROUND' ? new THREE.Vector3(0, 15, 60).applyQuaternion(this.player.quaternion) 
                                                       : new THREE.Vector3(0, 100, 400).applyQuaternion(this.jet.quaternion);
                if (this.state === 'EXTRACT' && this.cinematicTime > 6) off.set(600, 300, 600);
                this.camera.position.lerp(aEnt.position.clone().add(off), 0.1);
                this.camera.lookAt(aEnt.position);
            }
        }

        // --- Weapons & FX ---
        for (let i=this.missiles.length-1; i>=0; i--) {
            let m = this.missiles[i]; m.life -= dt; m.mesh.position.addScaledVector(m.vel, dt);
            let hit = false;
            
            if (m.mesh.position.y < this.getHeight(m.mesh.position.x, m.mesh.position.z)) hit = true;
            if (!hit) {
                for (let j=0; j<this.targets.length; j++) {
                    let tr = this.targets[j];
                    if (tr.active && tr.mesh.position.distanceTo(m.mesh.position) < 150) {
                        tr.hp -= 50; hit = true;
                        if (tr.hp <= 0) { tr.active = false; tr.mesh.visible = false; tr.box.visible = false; this.triggerExplosion(tr.mesh.position); }
                    }
                }
            }
            if(hit || m.life<=0) { this.scene.remove(m.mesh); this.missiles.splice(i,1); }
        }

        for (let i=this.explosions.length-1; i>=0; i--) {
            let ex = this.explosions[i]; ex.life -= dt;
            const p = 1.0 - (ex.life / 2.0);
            ex.ring.scale.setScalar(1.0 + p * 80); ex.ring.lookAt(this.camera.position);
            (ex.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, ex.life/2);
            const arr = ex.parts.geometry.attributes.position.array as Float32Array;
            for(let j=0; j<ex.vels.length; j++) { arr[j*3]+=ex.vels[j].x*dt; arr[j*3+1]+=ex.vels[j].y*dt; arr[j*3+2]+=ex.vels[j].z*dt; }
            ex.parts.geometry.attributes.position.needsUpdate = true;
            (ex.parts.material as THREE.PointsMaterial).opacity = Math.max(0, ex.life/2);
            if(ex.life<=0) { this.scene.remove(ex.ring, ex.parts); this.explosions.splice(i,1); }
        }

        let sx=0, sy=0;
        if (this.shakeMag > 0) {
            this.shakeMag -= dt*5; if(this.shakeMag<0) this.shakeMag=0;
            sx = (Math.random()-0.5)*40*this.shakeMag; sy = (Math.random()-0.5)*40*this.shakeMag;
            this.camera.position.x += sx; this.camera.position.y += sy;
        }

        if (this.flashFrames > 0) { this.scene.background = new THREE.Color(0xFFFFFF); this.flashFrames--; }
        else this.scene.background = (this.spaceInit || this.camMode === 'DRONE') ? new THREE.Color(0x050505) : new THREE.Color(0x87CEEB);

        // Render via Post Processor
        this.renderer.setRenderTarget(this.postProcess.target);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postProcess.scene, this.postProcess.camera);

        if (this.shakeMag > 0) { this.camera.position.x -= sx; this.camera.position.y -= sy; }
    }
}

// ============================================================================
// REACT ARCHITECTURE
// ============================================================================

export default function App() {
    const [screen, setScreen] = useState('WAR_MAP'); // 'WAR_MAP', 'GAME', 'VICTORY', 'COOP'
    const [unlocked, setUnlocked] = useState(() => parseInt(localStorage.getItem('SGMW_LVL') || '1'));
    const [selLvl, setSelLvl] = useState(1);
    
    // Audio
    const [audioPlay, setAudioPlay] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    useEffect(() => {
        if (!audioRef.current && typeof window !== 'undefined') {
            audioRef.current = new Audio('./audio/battle_hype.mp3');
            audioRef.current.loop = true;
        }
    }, []);
    useEffect(() => {
        if (audioRef.current) { if (audioPlay) audioRef.current.play().catch(()=>{}); else audioRef.current.pause(); }
    }, [audioPlay]);

    // Engine ref
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);
    const [hud, setHud] = useState({ progress: 0, cam: 'CHASE' });
    const [isGround, setIsGround] = useState(false);
    const [fade, setFade] = useState(false); // Used for boarding transition

    useEffect(() => {
        if (screen === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalEngine(canvasRef.current, selLvl);
            engineRef.current.onSync = (d) => { setHud(h => ({...h, ...d})); setIsGround(engineRef.current!.heroMode === 'GROUND'); };
            engineRef.current.onVictory = () => {
                const next = Math.max(unlocked, selLvl + 1);
                setUnlocked(next); localStorage.setItem('SGMW_LVL', next.toString());
                setScreen('VICTORY');
            };
        }
        return () => { if (screen !== 'GAME' && engineRef.current) { engineRef.current.dispose(); engineRef.current = null; } }
    }, [screen, selLvl]);

    // UI Input Handlers
    const Joystick = () => {
        const hM = (e: React.PointerEvent) => {
            if(e.buttons===0) return;
            const r = e.currentTarget.getBoundingClientRect();
            let dx = e.clientX - (r.left + r.width/2); let dy = e.clientY - (r.top + r.height/2);
            const rad = r.width/2; const d = Math.min(Math.hypot(dx,dy), rad); const a = Math.atan2(dy,dx);
            let nx = Math.cos(a)*d/rad; let ny = -Math.sin(a)*d/rad; // y flipped for engine
            if (engineRef.current) { engineRef.current.input.x = nx; engineRef.current.input.y = ny; }
            const stick = e.currentTarget.firstChild as HTMLDivElement;
            stick.style.transform = `translate(${dx}px, ${dy}px)`;
        };
        const hU = (e: React.PointerEvent) => {
            if (engineRef.current) { engineRef.current.input.x = 0; engineRef.current.input.y = 0; }
            (e.currentTarget.firstChild as HTMLDivElement).style.transform = `translate(0,0)`;
        };
        return (
            <div className={`w-40 h-40 rounded-full border border-[${C_BORDER}] shadow-[0_0_15px_${C_NEON}] flex items-center justify-center touch-none`} style={{background: C_PANEL}}
                 onPointerDown={hM} onPointerMove={hM} onPointerUp={hU} onPointerLeave={hU}>
                <div className={`w-12 h-12 rounded-full bg-[${C_NEON}] transition-transform duration-75`} />
            </div>
        );
    };

    return (
        <div className="fixed inset-0 overflow-hidden font-sans select-none bg-[#0a0c10] text-white" dir="rtl" style={{touchAction: 'none'}}>
            <style>{`
                .glass-panel { background: ${C_PANEL}; backdrop-filter: blur(10px); border: 1px solid ${C_BORDER}; box-shadow: 0 0 15px rgba(0,255,102,0.2); }
                .tactical-btn { background: ${C_PANEL}; border: 1px solid ${C_BORDER}; color: ${C_NEON}; text-transform: uppercase; font-weight: 900; transition: all 0.2s; box-shadow: 0 0 8px ${C_NEON}; }
                .tactical-btn:active { background: ${C_NEON}; color: #000; }
                .locked-level { filter: blur(2px) grayscale(100%); pointer-events: none; opacity: 0.5; }
                .transition-fade { transition: opacity 0.5s ease-in-out; }
            `}</style>
            
            {/* Global Audio Toggle (Visible globally) */}
            <button onClick={()=>setAudioPlay(!audioPlay)} className={`fixed top-8 left-8 z-[1000] p-4 w-16 h-16 border rounded-full ${audioPlay ? `border-[${C_NEON}] text-[${C_NEON}]` : `border-[#3F444A] text-gray-500`} glass-panel hover:scale-105 transition-transform`}>
                <IconMusic />
            </button>

            {screen === 'WAR_MAP' && (
                <div className="absolute inset-0 flex flex-col p-12">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,255,102,0.1)_0%,rgba(0,0,0,1)_100%)] pointer-events-none z-0" />
                    <svg className="absolute inset-0 w-full h-full opacity-10 pointer-events-none z-0">
                        <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M 60 0 L 0 0 0 60" fill="none" stroke={C_NEON} strokeWidth="1"/></pattern>
                        <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>

                    <div className="relative z-10 flex justify-between items-end mb-12 border-b border-[#3F444A] pb-6">
                        <h1 className={`text-5xl font-black drop-shadow-[0_0_15px_${C_NEON}]`}>الخريطة التكتيكية والحملات</h1>
                        <button onClick={()=>setScreen('COOP')} className="bg-transparent border border-[#00aaff] text-[#00aaff] shadow-[0_0_15px_rgba(0,170,255,0.4)] px-8 py-3 flex gap-4 items-center font-bold text-xl hover:bg-[#00aaff]/20 transition-colors">
                            <div className="w-6 h-6"><IconWifi /></div>
                            شبكة التحالف المحلي (WIFI Simulation)
                        </button>
                    </div>

                    <div className="relative z-10 flex-1 overflow-y-auto">
                        <div className="grid grid-cols-5 gap-8 pb-12">
                            {LEVELS.map(l => {
                                const isLocked = l.id > unlocked;
                                return (
                                    <div key={l.id} onClick={() => { if(!isLocked) { setSelLvl(l.id); setScreen('GAME'); } }}
                                         className={`p-6 border glass-panel flex flex-col items-center justify-center text-center aspect-square transition-transform ${isLocked ? 'locked-level' : 'hover:scale-105 hover:bg-[#00FF66]/10 cursor-pointer'}`}>
                                        <span className={`text-4xl font-black mb-4 ${isLocked ? 'text-gray-500' : `text-[${C_NEON}]`}`}>{l.id}</span>
                                        <span className="text-sm font-bold tracking-widest">{l.name}</span>
                                        {isLocked && <div className="mt-4 text-red-500"><IconLock /></div>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {screen === 'COOP' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-12">
                    <div className="glass-panel w-full max-w-4xl p-12 flex flex-col gap-8 relative z-10">
                        <h2 className="text-4xl font-black text-center border-b border-[#3F444A] pb-4">شبكة التحالف المحلي التكتيكي (0ms Latency)</h2>
                        <div className="space-y-4">
                            {[ { name: "كتيبة_شرعب", score: 14500 }, { name: "الصقر_التكتيكي", score: 12200 }, { name: "أنت (محلي)", score: unlocked * 5000 + 1000 } ].sort((a,b)=>b.score-a.score).map((p, i) => (
                                <div key={i} className={`flex justify-between p-6 border ${p.name.includes('أنت') ? `border-[${C_NEON}] bg-[${C_NEON}]/10 text-[${C_NEON}] font-black` : 'border-[#3F444A] bg-[#0A0C10]/50'}`}>
                                    <span className="text-2xl">{p.name}</span>
                                    <span className="text-xl">{p.score} PTS</span>
                                </div>
                            ))}
                        </div>
                        <button onClick={()=>setScreen('WAR_MAP')} className="tactical-btn w-full py-6 text-2xl mt-8">العودة للخريطة التكتيكية</button>
                    </div>
                </div>
            )}

            {screen === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
                    
                    {/* Viewport Fade for Transitions */}
                    <div className={`absolute inset-0 bg-black z-50 pointer-events-none transition-fade ${fade ? 'opacity-100' : 'opacity-0'}`} />

                    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-8 z-10">
                        
                        {/* Top HUD */}
                        <div className="flex justify-between items-start">
                            <div className="glass-panel p-6 flex flex-col gap-4">
                                <div className={`text-xl font-black text-[${C_NEON}]`}>SYS LINK: {hud.cam}</div>
                                <div className="text-sm font-bold w-64">
                                    <div className={`flex justify-between text-[${C_HOT}] mb-2`}><span>AWAITING EXTRACT:</span> <span>{hud.progress}%</span></div>
                                    <div className={`w-full h-2 bg-[#000] border border-[#3F444A]`}><div className={`h-full bg-[${C_HOT}] transition-all`} style={{width:`${hud.progress}%`}}/></div>
                                </div>
                            </div>

                            <div className="flex gap-4 pointer-events-auto">
                                {!isGround && (
                                    <>
                                        <button onClick={() => { if(engineRef.current) engineRef.current.camMode = engineRef.current.camMode === 'CHASE' ? 'COCKPIT' : (engineRef.current.camMode === 'COCKPIT' ? 'DRONE' : 'CHASE'); }} className="glass-panel p-4 w-16 h-16 text-white hover:text-[#00FF66]"><IconCam /></button>
                                        <button onClick={() => { if(engineRef.current) { engineRef.current.heroMode = 'GROUND'; engineRef.current.player.position.copy(engineRef.current.jet.position).add(new THREE.Vector3(0,0,80)); engineRef.current.player.visible = true; engineRef.current.camMode = 'CHASE'; } }} className="tactical-btn px-6 py-4 flex gap-4 items-center">
                                            <div className="w-6 h-6"><IconHeroDown /></div> إدراج أرضي
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Mid Screen Reticle */}
                        {!isGround && (hud.cam === 'CHASE' || hud.cam === 'COCKPIT') && (
                            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 opacity-50`}>
                                <div className={`absolute inset-0 border-4 border-[${C_NEON}] rounded-full border-t-transparent border-b-transparent animate-spin`} style={{animationDuration: '3s'}} />
                                <div className={`absolute top-1/2 left-1/2 w-2 h-2 bg-[${C_HOT}] rounded-full -translate-x-1/2 -translate-y-1/2`} />
                            </div>
                        )}

                        {/* Bottom Interacts */}
                        <div className="flex justify-between items-end pointer-events-auto">
                            <Joystick />

                            {isGround && (
                                <div className="flex gap-4 mb-4">
                                    <button onPointerDown={()=>engineRef.current&&(engineRef.current.isSprinting=true)} onPointerUp={()=>engineRef.current&&(engineRef.current.isSprinting=false)} className="tactical-btn px-8 py-4 text-2xl">جري</button>
                                    <button onPointerDown={()=>engineRef.current&&(engineRef.current.isCrouching=true)} onPointerUp={()=>engineRef.current&&(engineRef.current.isCrouching=false)} className="tactical-btn px-8 py-4 text-2xl">جلوس</button>
                                    <button onClick={()=>engineRef.current?.triggerRoll()} className="tactical-btn px-8 py-4 text-2xl border-[#ff0055] text-[#ff0055] shadow-[#ff0055]">مراوغة</button>
                                    <button onClick={() => {
                                        setFade(true);
                                        engineRef.current?.triggerBoarding(() => {
                                            if(engineRef.current) { engineRef.current.heroMode = 'AIR'; engineRef.current.player.visible = false; engineRef.current.camMode = 'COCKPIT'; }
                                            setFade(false);
                                        });
                                    }} className="tactical-btn px-8 py-4 text-2xl border-[#00aaff] text-[#00aaff] shadow-[#00aaff]">عودة للطائرة</button>
                                </div>
                            )}

                            <button onPointerDown={(e)=>{e.stopPropagation(); engineRef.current?.fire();}} className={`w-32 h-32 rounded-full border border-[${C_HOT}] bg-[#121416] text-[${C_HOT}] shadow-[0_0_20px_${C_HOT}] flex items-center justify-center outline-none active:scale-95 active:bg-[${C_HOT}] active:text-black transition-all`}>
                                <div className="w-16 h-16"><IconTarget /></div>
                            </button>
                        </div>

                    </div>
                </>
            )}

            {screen === 'VICTORY' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-12 z-50">
                    <div className="glass-panel p-20 flex flex-col items-center text-center max-w-4xl w-full border-[${C_NEON}] shadow-[0_0_40px_${C_NEON}]">
                        <div className={`w-24 h-24 text-[${C_NEON}] mb-8`}><IconTarget /></div>
                        <h2 className={`text-6xl font-black mb-8 tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-[${C_NEON}] leading-loose`}>
                            تم تحقيق النصر التكتيكي ومسح القطاع بنجاح
                        </h2>
                        <button onClick={()=>setScreen('WAR_MAP')} className="w-full py-8 mt-12 text-3xl font-black tracking-widest tactical-btn">
                            تأكيد الانسحاب والعودة للقيادة
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
