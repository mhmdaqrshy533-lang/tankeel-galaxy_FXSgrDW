import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';

// ============================================================================
// AAA GAME CONSTANTS & CONFIGURATION
// ============================================================================

const C_BG = '#030406';
const C_PANEL = '#0A0D10';
const C_PANEL_HOVER = '#10151A';
const C_BORDER_DIM = '#1C2329';
const C_BORDER_FOCUS = '#2D3944';
const C_ACCENT = '#00FF66'; // Tactical Green
const C_DANGER = '#FF0055'; // Tactical Pink/Red
const C_TEXT = '#E2E8F0';
const C_TEXT_DIM = '#64748B';

const VALID_CODES = ['SGM-2026-VIP', 'DEV-ALPHA-1337', 'OPERATOR-X'];

const RANKS = [
    { name: 'مُجند (Recruit)', xp: 0 },
    { name: 'جندي (Soldier)', xp: 1000 },
    { name: 'عريف (Corporal)', xp: 3000 },
    { name: 'رقيب (Sergeant)', xp: 6000 },
    { name: 'ملازم (Lieutenant)', xp: 10000 },
    { name: 'نقيب (Captain)', xp: 15000 },
    { name: 'رائد (Major)', xp: 22000 },
    { name: 'عقيد (Colonel)', xp: 30000 },
    { name: 'جنرال (General)', xp: 50000 }
];

const GARAGE = {
    AIR: [
        { id: 'jet_stealth', name: 'B-2 Ghost Stealth Bomber', type: 'AIR', desc: 'Advanced radar evasion and heavy payload.' },
        { id: 'jet_fighter', name: 'F-22 Raptor Interceptor', type: 'AIR', desc: 'Air superiority and unmatched agility.' },
        { id: 'heli_attack', name: 'AH-64 Apache', type: 'AIR', desc: 'Close air support and sustained firepower.' }
    ],
    GROUND: [
        { id: 'tank_main', name: 'M1A2 Abrams', type: 'GROUND', desc: 'Heavy armor and 120mm smoothbore cannon.' },
        { id: 'apc_light', name: 'Stryker ICV', type: 'GROUND', desc: 'Rapid troop deployment and mobility.' }
    ],
    NAVAL: [
        { id: 'ship_destroyer', name: 'Arleigh Burke', type: 'NAVAL', desc: 'Guided missile destroyer for coastal bombardment.' }
    ]
};

// ============================================================================
// ICONS (SVG)
// ============================================================================

const IconCrosshair = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-full h-full"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/></svg>;
const IconLock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
const IconPlay = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8"><path d="M5 3l14 9-14 9V3z" /></svg>;
const IconUser = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconShield = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconSettings = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconCamera = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const IconMusic = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;

// ============================================================================
// PROFILE & PERSISTENCE
// ============================================================================

interface SGMProfile {
    username: string;
    xp: number;
    usedCodes: string[];
    unlockedVehicles: string[];
    activeAir: string;
    activeGround: string;
    activeNaval: string;
    settings: { graphics: 'LOW' | 'MED' | 'HIGH'; volume: number; };
}

const DEFAULT_PROFILE: SGMProfile = {
    username: 'Operator-001',
    xp: 0,
    usedCodes: [],
    unlockedVehicles: ['jet_stealth', 'tank_main', 'ship_destroyer'],
    activeAir: 'jet_stealth',
    activeGround: 'tank_main',
    activeNaval: 'ship_destroyer',
    settings: { graphics: 'HIGH', volume: 80 }
};

function useSGMProfile() {
    const [profile, setProfile] = useState<SGMProfile>(() => {
        try { const saved = localStorage.getItem('SGMW_AAA_SAVE_V2'); return saved ? JSON.parse(saved) : DEFAULT_PROFILE; } 
        catch { return DEFAULT_PROFILE; }
    });

    useEffect(() => { localStorage.setItem('SGMW_AAA_SAVE_V2', JSON.stringify(profile)); }, [profile]);
    
    const getRank = (xp: number) => {
        let currentRank = RANKS[0];
        let nextRank = RANKS[1];
        for (let i = 0; i < RANKS.length; i++) {
            if (xp >= RANKS[i].xp) { currentRank = RANKS[i]; nextRank = RANKS[i+1] || RANKS[i]; }
        }
        return { currentRank, nextRank };
    };

    return { profile, setProfile, getRank };
}

// ============================================================================
// SHADERS & TEXTURE GENERATORS
// ============================================================================

function createHeroVestTexture(username: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    
    // Yemen Flag Colors (Red, White, Black)
    ctx.fillStyle = '#CE1126'; ctx.fillRect(0, 0, 1024, 341);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 341, 1024, 342);
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 683, 1024, 341);
    
    // Text Overlay
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111111';
    ctx.font = '900 120px "Courier New", monospace';
    ctx.fillText('تنكيل-SGMW', 512, 450);
    
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 80px "Courier New", monospace';
    ctx.fillText(username, 512, 580);
    
    return new THREE.CanvasTexture(canvas);
}

// ============================================================================
// SGMW AAA WEBGL ENGINE
// ============================================================================

class TacticalEngine {
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    
    // Physics & Timing
    private clock = new THREE.Clock();
    public state: 'BRIEFING' | 'DEPLOYED' | 'SPACE_TRANSITION' | 'VICTORY' = 'DEPLOYED';
    
    // Cameras
    public camMain = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 1, 100000);
    public camMode: 'FPS' | 'TPS' | 'DRONE' | 'CINEMATIC' = 'TPS';
    
    // Input Vectors
    public input = { x: 0, y: 0, sprint: false, crouch: false };
    
    // Player / Vehicle Entities
    public heroMode: 'GROUND' | 'AIR' = 'AIR';
    public jet = new THREE.Group();
    public player = new THREE.Group();
    
    // Physics States
    private airSpeed = 600;
    private maxAirSpeed = 2000;
    private airPitch = 0;
    private airRoll = 0;
    public throttleActive = false;
    
    private groundSpeed = 0;
    private dodgeLife = 0;
    private dodgeDir = 1;
    
    // Procedural Environment
    private terrainMat = new THREE.MeshStandardMaterial({ color: 0x1A281A, roughness: 0.9, flatShading: true });
    private targets: { mesh: THREE.Mesh, hp: number, active: boolean }[] = [];
    private projectiles: { mesh: THREE.Mesh, vel: THREE.Vector3, life: number }[] = [];
    private explosions: { ring: THREE.Mesh, parts: THREE.Points, life: number, vels: THREE.Vector3[] }[] = [];
    
    // Atmosphere & Space
    private spaceGroup = new THREE.Group();
    private earth?: THREE.Mesh;
    private cinematicTime = 0;
    
    // FX
    private flashFrames = 0;
    private shakeMag = 0;

    // Callbacks
    public onSync?: (data: any) => void;
    public onVictory?: () => void;
    
    private username: string;

    constructor(canvas: HTMLCanvasElement, username: string) {
        this.username = username;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.00015);

        // Lighting
        const amb = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1.5);
        dir.position.set(5000, 10000, 5000);
        dir.castShadow = true;
        dir.shadow.camera.left = -5000; dir.shadow.camera.right = 5000;
        dir.shadow.camera.top = 5000; dir.shadow.camera.bottom = -5000;
        dir.shadow.camera.far = 20000;
        this.scene.add(amb, dir);

        this.buildWorld();
        this.buildHero();
        this.buildJet();
        this.buildSpaceTransit();

        window.addEventListener('resize', this.onResize);
        this.renderer.setAnimationLoop(this.animate);
    }

    private onResize = () => {
        this.camMain.aspect = window.innerWidth / window.innerHeight;
        this.camMain.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.setAnimationLoop(null);
        this.renderer.dispose();
    }

    // --- PROCEDURAL GENERATION ---
    private noise(x: number, z: number) { return Math.sin(x) * Math.cos(z); }
    private getHeight(x: number, z: number) {
        return (this.noise(x * 0.001, z * 0.001) * 400) + (Math.sin(x*0.005 + z*0.008)*100);
    }

    private buildWorld() {
        const tGeo = new THREE.PlaneGeometry(40000, 40000, 128, 128);
        tGeo.rotateX(-Math.PI/2);
        const pos = tGeo.attributes.position;
        for (let i=0; i<pos.count; i++) pos.setY(i, this.getHeight(pos.getX(i), pos.getZ(i)));
        tGeo.computeVertexNormals();
        const tMesh = new THREE.Mesh(tGeo, this.terrainMat);
        tMesh.receiveShadow = true;
        this.scene.add(tMesh);

        // Spawn Targets
        for (let i=0; i<3; i++) {
            const trg = new THREE.Mesh(new THREE.BoxGeometry(100, 200, 100), new THREE.MeshStandardMaterial({color: 0x111111, emissive: 0x220000}));
            trg.position.set((Math.random()-0.5)*15000, 0, -10000 - Math.random()*15000);
            trg.position.y = this.getHeight(trg.position.x, trg.position.z) + 100;
            trg.castShadow = true;
            this.scene.add(trg);
            this.targets.push({ mesh: trg, hp: 100, active: true });
        }
    }

    private buildSpaceTransit() {
        const sGeo = new THREE.BufferGeometry();
        const sPos = new Float32Array(5000 * 3);
        for(let i=0; i<5000*3; i++) sPos[i] = (Math.random()-0.5)*80000;
        sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
        this.stars = new THREE.Points(sGeo, new THREE.PointsMaterial({color: 0xffffff, size: 40}));
        
        this.earth = new THREE.Mesh(new THREE.SphereGeometry(8000, 64, 64), new THREE.MeshStandardMaterial({color: 0x0044bb, emissive: 0x001133, roughness: 0.8}));
        this.earth.position.set(0, 0, -20000);
        
        this.spaceGroup.add(this.stars, this.earth);
        this.spaceGroup.position.set(0, 40000, 0);
        this.spaceGroup.visible = false;
        this.scene.add(this.spaceGroup);
    }

    private buildHero() {
        const gMat = new THREE.MeshStandardMaterial({ color: 0x1A1C20, roughness: 0.9 });
        const vTex = createHeroVestTexture(this.username);
        const vestMat = new THREE.MeshStandardMaterial({ map: vTex, roughness: 0.8 });
        
        const torso = new THREE.Mesh(new THREE.BoxGeometry(2, 3.5, 1.2), vestMat); torso.position.y = 3; torso.castShadow = true;
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.3), new THREE.MeshStandardMaterial({color: 0x111111})); head.position.y = 5.5; head.castShadow = true;
        const visor = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.35, 0.2), new THREE.MeshBasicMaterial({color: C_ACCENT})); visor.position.set(0, 5.5, 0.61);
        
        this.player.add(torso, head, visor);
        this.player.visible = false;
        this.scene.add(this.player);
    }

    private buildJet() {
        const cMat = new THREE.MeshStandardMaterial({color: 0x1A1D24, roughness: 0.5, metalness: 0.8});
        const body = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 24), cMat); body.castShadow = true;
        
        const wGeo = new THREE.BufferGeometry();
        const wPts = new Float32Array([0,0,-8, 45,0,12, 0,0,10, 0,0,-8, 0,0,10, -45,0,12]);
        wGeo.setAttribute('position', new THREE.BufferAttribute(wPts, 3));
        wGeo.computeVertexNormals();
        const wings = new THREE.Mesh(wGeo, cMat); wings.castShadow = true;
        
        const cockpit = new THREE.Group();
        cockpit.position.set(0, 1.5, -6);
        const dash = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2, 3), new THREE.MeshStandardMaterial({color: 0x050505})); dash.position.set(0,-1,-2);
        
        // Active Gyro
        const gyro = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 16), new THREE.MeshBasicMaterial({color: C_ACCENT, wireframe: true}));
        gyro.position.set(-1.5, -0.2, -1.8); gyro.rotation.x = Math.PI/2;
        gyro.name = 'GYRO';
        
        cockpit.add(dash, gyro);
        this.jet.add(body, wings, cockpit);
        this.jet.position.set(0, 2000, 0);
        this.scene.add(this.jet);
    }

    // --- ACTIONS ---
    public toggleCamera() {
        const modes: ('FPS'|'TPS'|'DRONE'|'CINEMATIC')[] = ['TPS', 'FPS', 'DRONE', 'CINEMATIC'];
        this.camMode = modes[(modes.indexOf(this.camMode) + 1) % modes.length];
        this.sync();
    }

    public switchMode() {
        if (this.state !== 'DEPLOYED') return;
        if (this.heroMode === 'AIR') {
            this.heroMode = 'GROUND';
            this.player.position.copy(this.jet.position).add(new THREE.Vector3(0,0,50));
            this.airSpeed = 0; this.airPitch = 0; this.airRoll = 0;
            this.player.visible = true;
        } else {
            const dist = this.player.position.distanceTo(this.jet.position);
            if (dist < 400) { this.heroMode = 'AIR'; this.player.visible = false; }
        }
        this.sync();
    }

    public executeDodge() {
        if (this.heroMode === 'GROUND' && this.dodgeLife <= 0) {
            this.dodgeLife = 0.4;
            this.dodgeDir = this.input.x < 0 ? 1 : -1;
        }
    }

    public fire() {
        this.shakeMag = 1.0; this.flashFrames = 1;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 30).rotateX(Math.PI/2), new THREE.MeshBasicMaterial({color: C_ACCENT}));
        const src = this.heroMode === 'AIR' ? this.jet : this.player;
        b.position.copy(src.position).add(new THREE.Vector3(0, this.heroMode==='AIR'?0:4, 0));
        b.quaternion.copy(src.quaternion);
        this.projectiles.push({ mesh: b, vel: new THREE.Vector3(0,0,-8000).applyQuaternion(b.quaternion), life: 4.0 });
        this.scene.add(b);
    }

    private triggerExplosion(pos: THREE.Vector3) {
        this.shakeMag = 3.0; this.flashFrames = 4;
        
        // Neon Shockwave
        const ringGeo = new THREE.RingGeometry(1, 8, 32);
        const ringMat = new THREE.MeshBasicMaterial({color: C_DANGER, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending});
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        this.scene.add(ring);

        // Glowing Fragments
        const pGeo = new THREE.BufferGeometry();
        const pArr = new Float32Array(800 * 3); const cArr = new Float32Array(800 * 3); const vels = [];
        const c1 = new THREE.Color(C_DANGER); const c2 = new THREE.Color(C_ACCENT);
        for(let i=0; i<800; i++) {
            pArr[i*3]=pos.x; pArr[i*3+1]=pos.y; pArr[i*3+2]=pos.z;
            vels.push(new THREE.Vector3((Math.random()-0.5)*2, (Math.random()*2), (Math.random()-0.5)*2).normalize().multiplyScalar(600+Math.random()*800));
            const c = Math.random()>0.5 ? c1 : c2;
            cArr[i*3]=c.r; cArr[i*3+1]=c.g; cArr[i*3+2]=c.b;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
        pGeo.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
        const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({size: 30, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending}));
        this.scene.add(parts);

        this.explosions.push({ring, parts, life: 2.0, vels});
        this.sync();
    }

    private sync() {
        if (!this.onSync) return;
        const activeTargets = this.targets.filter(t => t.active).length;
        this.onSync({
            progress: Math.floor(((3-activeTargets)/3)*100),
            camMode: this.camMode,
            heroMode: this.heroMode,
            state: this.state,
            alt: this.heroMode === 'AIR' ? this.jet.position.y : this.player.position.y
        });

        if (activeTargets === 0 && this.state === 'DEPLOYED') {
            this.state = 'SPACE_TRANSITION';
            this.camMode = 'CINEMATIC';
            this.heroMode = 'AIR';
            this.player.visible = false;
            this.spaceGroup.visible = true;
            this.scene.fog = null;
        }
    }

    // --- MAIN LOOP ---
    private animate = () => {
        const dt = Math.min(this.clock.getDelta(), 0.1);

        // 1. PHYSICS ENFORCEMENT & INTERPOLATION
        if (this.state === 'DEPLOYED') {
            if (this.heroMode === 'AIR') {
                // Aerospace Dynamics
                if (this.input.x === 0) this.airRoll = THREE.MathUtils.lerp(this.airRoll, 0, 0.1);
                else { this.airRoll += this.input.x * dt * 2.5; this.airRoll = THREE.MathUtils.clamp(this.airRoll, -Math.PI/2.5, Math.PI/2.5); }
                
                if (this.input.y === 0) this.airPitch = THREE.MathUtils.lerp(this.airPitch, 0, 0.1);
                else { this.airPitch += this.input.y * dt * 2.5; this.airPitch = THREE.MathUtils.clamp(this.airPitch, -Math.PI/3, Math.PI/3); }

                this.airSpeed = THREE.MathUtils.lerp(this.airSpeed, this.throttleActive ? this.maxAirSpeed : 600, 0.05);

                this.jet.rotation.x = this.airPitch;
                this.jet.rotation.z = -this.airRoll;
                this.jet.rotation.y -= this.airRoll * dt * 1.2;
                this.jet.translateZ(-this.airSpeed * dt);

                const minH = this.getHeight(this.jet.position.x, this.jet.position.z) + 150;
                if (this.jet.position.y < minH) { this.jet.position.y = THREE.MathUtils.lerp(this.jet.position.y, minH, 0.1); this.airPitch = Math.max(0, this.airPitch); }

                // Update Cockpit Instruments
                const gyro = this.jet.getObjectByName('GYRO');
                if (gyro) { gyro.rotation.z = -this.airRoll; gyro.rotation.x = Math.PI/2 + this.airPitch; }

            } else {
                // Ground Tactical
                const tarScaleY = this.input.crouch ? 0.5 : 1.0;
                this.player.scale.y = THREE.MathUtils.lerp(this.player.scale.y, tarScaleY, dt * 10);
                
                if (this.dodgeLife > 0) {
                    this.dodgeLife -= dt;
                    this.player.translateX(this.dodgeDir * 1200 * dt);
                } else {
                    const tarSpeed = this.input.crouch ? 80 : (this.input.sprint ? 400 : 180);
                    this.groundSpeed = THREE.MathUtils.lerp(this.groundSpeed, this.input.y !== 0 ? tarSpeed : 0, 0.2);
                    this.player.rotation.y -= this.input.x * 3.5 * dt;
                    this.player.translateZ(this.input.y > 0 ? this.groundSpeed * dt : -this.groundSpeed * dt);
                }
                
                this.player.position.y = this.getHeight(this.player.position.x, this.player.position.z);
            }
        } else if (this.state === 'SPACE_TRANSITION') {
            this.cinematicTime += dt;
            this.airPitch = THREE.MathUtils.lerp(this.airPitch, Math.PI/3.5, dt * 1.5);
            this.airSpeed = THREE.MathUtils.lerp(this.airSpeed, 12000, dt);
            
            this.jet.rotation.x = this.airPitch;
            this.jet.rotation.z = 0;
            this.jet.translateZ(-this.airSpeed * dt);
            
            if (this.cinematicTime > 4) {
                const orbT = (this.cinematicTime - 4) * 0.3;
                this.scene.background = new THREE.Color(0x010204);
                this.jet.position.x = this.earth!.position.x + Math.sin(orbT)*12000;
                this.jet.position.z = this.earth!.position.z + Math.cos(orbT)*12000;
                this.jet.position.y = 40000;
                this.jet.lookAt(this.earth!.position);
                this.jet.rotateY(Math.PI/2);
                
                if (orbT > Math.PI * 2 && this.onVictory) { 
                    this.state = 'VICTORY'; this.onVictory(); this.onVictory = undefined; 
                }
            }
        }

        // 2. PROJECTILES & COLLISIONS
        for (let i=this.projectiles.length-1; i>=0; i--) {
            let p = this.projectiles[i]; p.life -= dt;
            p.mesh.position.addScaledVector(p.vel, dt);
            let hit = false;
            
            if (p.mesh.position.y < this.getHeight(p.mesh.position.x, p.mesh.position.z)) hit = true;
            
            if (!hit) {
                for (let j=0; j<this.targets.length; j++) {
                    let tr = this.targets[j];
                    if (tr.active && tr.mesh.position.distanceTo(p.mesh.position) < 150) {
                        tr.hp -= 50; hit = true;
                        if (tr.hp <= 0) { tr.active = false; tr.mesh.visible = false; this.triggerExplosion(tr.mesh.position); }
                    }
                }
            }
            if (hit || p.life<=0) { this.scene.remove(p.mesh); this.projectiles.splice(i,1); }
        }

        // 3. VFX
        for (let i=this.explosions.length-1; i>=0; i--) {
            let ex = this.explosions[i]; ex.life -= dt;
            const pRatio = 1.0 - (ex.life / 2.0);
            
            ex.ring.scale.setScalar(1.0 + pRatio * 60);
            ex.ring.lookAt(this.camMain.position);
            (ex.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, ex.life/2);
            
            const arr = ex.parts.geometry.attributes.position.array as Float32Array;
            for(let j=0; j<ex.vels.length; j++) { arr[j*3] += ex.vels[j].x*dt; arr[j*3+1] += ex.vels[j].y*dt; arr[j*3+2] += ex.vels[j].z*dt; }
            ex.parts.geometry.attributes.position.needsUpdate = true;
            (ex.parts.material as THREE.PointsMaterial).opacity = Math.max(0, ex.life/2);
            
            if (ex.life<=0) { this.scene.remove(ex.ring, ex.parts); this.explosions.splice(i,1); }
        }

        // 4. CAMERA MATRIX
        const activeEntity = this.heroMode === 'AIR' ? this.jet : this.player;
        if (this.camMode === 'TPS' || this.state === 'SPACE_TRANSITION') {
            const offset = this.heroMode === 'AIR' ? new THREE.Vector3(0, 80, 400).applyQuaternion(this.jet.quaternion) : new THREE.Vector3(0, 15, 60).applyQuaternion(this.player.quaternion);
            this.camMain.position.lerp(activeEntity.position.clone().add(offset), 0.1);
            this.camMain.lookAt(activeEntity.position);
        } else if (this.camMode === 'FPS') {
            const offset = this.heroMode === 'AIR' ? new THREE.Vector3(0, 2, -5).applyMatrix4(this.jet.matrixWorld) : new THREE.Vector3(0, 5, 0).applyMatrix4(this.player.matrixWorld);
            this.camMain.position.copy(offset);
            this.camMain.quaternion.copy(activeEntity.quaternion);
        } else if (this.camMode === 'DRONE') {
            this.camMain.position.copy(activeEntity.position).add(new THREE.Vector3(0, 2500, 0));
            this.camMain.lookAt(activeEntity.position);
        } else if (this.camMode === 'CINEMATIC') {
            const offset = new THREE.Vector3(600, 200, 600);
            this.camMain.position.lerp(activeEntity.position.clone().add(offset), 0.05);
            this.camMain.lookAt(activeEntity.position);
        }

        // Screen Shakes & Overrides
        let sx=0, sy=0;
        if (this.shakeMag > 0) {
            this.shakeMag -= dt*4; if(this.shakeMag<0) this.shakeMag=0;
            sx = (Math.random()-0.5)*50*this.shakeMag; sy = (Math.random()-0.5)*50*this.shakeMag;
            this.camMain.position.x += sx; this.camMain.position.y += sy;
        }

        if (this.flashFrames > 0) { this.scene.background = new THREE.Color(0xFFFFFF); this.flashFrames--; }
        else if (this.camMode === 'DRONE') this.scene.background = new THREE.Color(0x05080A);
        else this.scene.background = this.state === 'SPACE_TRANSITION' ? new THREE.Color(0x010204) : new THREE.Color(0x87CEEB);

        this.renderer.render(this.scene, this.camMain);
        if (this.shakeMag > 0) { this.camMain.position.x -= sx; this.camMain.position.y -= sy; }
    }
}

// ============================================================================
// REACT UI ARCHITECTURE (AAA DESIGN)
// ============================================================================

export default function App() {
    const { profile, setProfile, getRank } = useSGMProfile();
    const rankData = getRank(profile.xp);
    
    const [view, setView] = useState<'MAIN' | 'PROFILE' | 'GARAGE' | 'SETTINGS' | 'GAME' | 'VICTORY'>('MAIN');
    const [audioPlay, setAudioPlay] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Initial Audio Setup
    useEffect(() => {
        if (!audioRef.current && typeof window !== 'undefined') {
            audioRef.current = new Audio('./audio/battle_hype.mp3');
            audioRef.current.loop = true;
        }
    }, []);

    useEffect(() => {
        if (audioRef.current) {
            if (audioPlay) audioRef.current.play().catch(()=>{});
            else audioRef.current.pause();
        }
    }, [audioPlay]);

    // Engine Bridge
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);
    const [hud, setHud] = useState({ progress: 0, camMode: 'TPS', heroMode: 'AIR', state: 'DEPLOYED', alt: 0 });

    useEffect(() => {
        if (view === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalEngine(canvasRef.current, profile.username);
            engineRef.current.onSync = (d) => setHud(h => ({...h, ...d}));
            engineRef.current.onVictory = () => {
                setProfile(p => ({...p, xp: p.xp + 5000}));
                setView('VICTORY');
            };
        }
        return () => { if (view !== 'GAME' && engineRef.current) { engineRef.current.dispose(); engineRef.current = null; } }
    }, [view, profile.username, setProfile]);

    const sBtn = `px-8 py-4 bg-[${C_PANEL}] hover:bg-[${C_PANEL_HOVER}] border border-[${C_BORDER_DIM}] hover:border-[${C_ACCENT}] text-white font-black tracking-widest uppercase transition-all flex items-center justify-between group`;
    const sCard = `p-8 bg-[${C_PANEL}]/90 border border-[${C_BORDER_DIM}] backdrop-blur-xl shadow-2xl`;

    const ActivationModal = () => {
        const [code, setCode] = useState('');
        const [user, setUser] = useState('');
        const [err, setErr] = useState('');
        
        const submit = () => {
            if (!VALID_CODES.includes(code)) { setErr('Invalid Activation Code. Verification Failed.'); return; }
            if (profile.usedCodes.includes(code)) { setErr('Code already registered to a military profile.'); return; }
            if (user.length < 3) { setErr('Operator designation must be at least 3 characters.'); return; }
            setProfile(p => ({ ...p, username: user, usedCodes: [...p.usedCodes, code] }));
            setView('MAIN');
        };

        return (
            <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md`}>
                <div className={`${sCard} w-full max-w-xl flex flex-col gap-6`}>
                    <h2 className={`text-3xl font-black text-[${C_ACCENT}] uppercase tracking-widest border-b border-[${C_BORDER_DIM}] pb-4`}>Classified Clearance Authorization</h2>
                    {err && <div className={`p-4 bg-[${C_DANGER}]/20 border border-[${C_DANGER}] text-[${C_DANGER}] font-bold`}>{err}</div>}
                    <div className="flex flex-col gap-2">
                        <label className={`text-xs text-[${C_TEXT_DIM}] font-bold uppercase`}>Enter Activation Cipher</label>
                        <input value={code} onChange={e=>setCode(e.target.value)} className={`w-full bg-black border border-[${C_BORDER_DIM}] px-4 py-3 text-white outline-none focus:border-[${C_ACCENT}]`} placeholder="SGM-XXXX-XXX" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className={`text-xs text-[${C_TEXT_DIM}] font-bold uppercase`}>New Operator Designation</label>
                        <input value={user} onChange={e=>setUser(e.target.value)} className={`w-full bg-black border border-[${C_BORDER_DIM}] px-4 py-3 text-white outline-none focus:border-[${C_ACCENT}]`} placeholder="Callsign" />
                    </div>
                    <div className="flex gap-4 mt-4">
                        <button onClick={submit} className={`flex-1 py-4 bg-[${C_ACCENT}]/10 border border-[${C_ACCENT}] text-[${C_ACCENT}] font-black hover:bg-[${C_ACCENT}] hover:text-black transition-colors uppercase`}>Authorize & Overwrite</button>
                        <button onClick={()=>setView('MAIN')} className={`px-8 border border-[${C_BORDER_DIM}] text-white hover:bg-white/10 uppercase font-black`}>Abort</button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 select-none overflow-hidden" style={{ backgroundColor: C_BG, color: C_TEXT, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            <style>{`
                .vignette { box-shadow: inset 0 0 200px rgba(0,0,0,0.9); pointer-events: none; }
                .glow-text { text-shadow: 0 0 10px ${C_ACCENT}; }
                .glow-border { box-shadow: 0 0 15px ${C_ACCENT}40; border-color: ${C_ACCENT}; }
                .tactical-mask { clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
            `}</style>
            
            <div className="absolute inset-0 z-[900] vignette" />

            {/* --- GLOBAL AUDIO TOGGLE --- */}
            <div className="fixed top-8 right-8 z-[1000]">
                <button onClick={() => setAudioPlay(!audioPlay)} className={`p-4 bg-[${C_PANEL}]/80 backdrop-blur-md border border-[${C_BORDER_DIM}] ${audioPlay ? `text-[${C_ACCENT}] border-[${C_ACCENT}]` : 'text-white'}`}>
                    <IconMusic />
                </button>
            </div>

            {/* ==================== MENUS ==================== */}
            {view !== 'GAME' && view !== 'VICTORY' && (
                <div className="absolute inset-0 flex flex-col bg-[url('https://images.unsplash.com/photo-1508138221679-760a23a2285b?q=80&w=2574&auto=format&fit=crop')] bg-cover bg-center">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl" />
                    
                    <div className="relative z-10 flex flex-col h-full p-16 max-w-7xl mx-auto w-full">
                        {/* Header */}
                        <div className="flex justify-between items-end border-b border-white/10 pb-8 mb-12">
                            <div>
                                <h1 className={`text-6xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-[${C_TEXT_DIM}] uppercase`}>
                                    تنكيل-SGMW
                                </h1>
                                <p className={`mt-2 text-xl font-bold text-[${C_ACCENT}] tracking-[0.2em] uppercase`}>Advanced Military Simulator Platform</p>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-black uppercase text-white">{profile.username}</div>
                                <div className={`text-sm font-bold text-[${C_TEXT_DIM}] uppercase tracking-widest`}>{rankData.currentRank.name}</div>
                            </div>
                        </div>

                        {/* Routes */}
                        <div className="flex-1 flex gap-12">
                            {/* Navigation Sidebar */}
                            <div className="w-96 flex flex-col gap-4">
                                <button onClick={()=>setView('GAME')} className={sBtn}>
                                    <span>Deploy Simulation</span>
                                    <div className={`w-8 h-8 text-[${C_ACCENT}]`}><IconPlay /></div>
                                </button>
                                <button onClick={()=>setView('PROFILE')} className={`${sBtn} ${view==='PROFILE'?`border-[${C_ACCENT}] text-[${C_ACCENT}]`:''}`}>
                                    <span>Operator Profile</span>
                                    <div className="w-6 h-6"><IconUser /></div>
                                </button>
                                <button onClick={()=>setView('GARAGE')} className={`${sBtn} ${view==='GARAGE'?`border-[${C_ACCENT}] text-[${C_ACCENT}]`:''}`}>
                                    <span>Vehicle Hangar</span>
                                    <div className="w-6 h-6"><IconShield /></div>
                                </button>
                                <button onClick={()=>setView('SETTINGS')} className={`${sBtn} ${view==='SETTINGS'?`border-[${C_ACCENT}] text-[${C_ACCENT}]`:''}`}>
                                    <span>System Config</span>
                                    <div className="w-6 h-6"><IconSettings /></div>
                                </button>
                            </div>

                            {/* Content Area */}
                            <div className="flex-1 relative">
                                {view === 'PROFILE' && (
                                    <div className={`${sCard} h-full animate-fade-in`}>
                                        <h2 className="text-3xl font-black uppercase tracking-widest mb-8 border-l-4 border-[#00FF66] pl-4">Service Record</h2>
                                        
                                        <div className="mb-12">
                                            <div className="flex justify-between items-end mb-4">
                                                <div className="text-2xl font-black uppercase">{rankData.currentRank.name}</div>
                                                <div className={`text-lg font-bold text-[${C_ACCENT}]`}>{profile.xp.toLocaleString()} XP</div>
                                            </div>
                                            <div className="w-full h-4 bg-black border border-white/10 relative">
                                                <div className={`absolute top-0 left-0 h-full bg-[${C_ACCENT}]`} style={{ width: `${(profile.xp / rankData.nextRank.xp) * 100}%` }} />
                                            </div>
                                            <div className="text-right mt-2 text-sm font-bold text-white/50 uppercase">Next Rank: {rankData.nextRank.name} at {rankData.nextRank.xp.toLocaleString()} XP</div>
                                        </div>

                                        <div className="p-6 bg-black/50 border border-white/5 flex justify-between items-center">
                                            <div>
                                                <div className="text-lg font-black uppercase mb-1">Designation Registry</div>
                                                <div className={`text-sm text-[${C_TEXT_DIM}]`}>Requires Central Command Authorization Cipher</div>
                                            </div>
                                            <button onClick={()=>setView('MAIN')} className={`px-6 py-3 border border-[${C_ACCENT}] text-[${C_ACCENT}] font-black uppercase hover:bg-[${C_ACCENT}] hover:text-black transition-colors`}>
                                                Unlock Identity
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {view === 'GARAGE' && (
                                    <div className={`${sCard} h-full flex flex-col animate-fade-in`}>
                                        <h2 className="text-3xl font-black uppercase tracking-widest mb-8 border-l-4 border-[#00FF66] pl-4">Asset Requisition Hangar</h2>
                                        <div className="flex-1 overflow-y-auto space-y-8 pr-4">
                                            {Object.entries(GARAGE).map(([cat, vehi]) => (
                                                <div key={cat}>
                                                    <h3 className={`text-xl font-black text-[${C_TEXT_DIM}] uppercase tracking-widest mb-4`}>{cat} ASSETS</h3>
                                                    <div className="grid grid-cols-2 gap-4">
                                                        {vehi.map(v => (
                                                            <div key={v.id} className={`p-6 border ${profile.unlockedVehicles.includes(v.id) ? `border-[${C_BORDER_FOCUS}] bg-black/40` : `border-red-900/30 bg-red-950/10`} tactical-mask relative overflow-hidden group`}>
                                                                <div className="relative z-10">
                                                                    <div className="text-xl font-black uppercase mb-2 text-white">{v.name}</div>
                                                                    <div className={`text-sm text-[${C_TEXT_DIM}] font-bold mb-6 h-10`}>{v.desc}</div>
                                                                    {profile.unlockedVehicles.includes(v.id) ? (
                                                                        <button className={`w-full py-3 border border-[${C_ACCENT}] text-[${C_ACCENT}] font-black uppercase group-hover:bg-[${C_ACCENT}] group-hover:text-black transition-colors`}>
                                                                            Authorize Role
                                                                        </button>
                                                                    ) : (
                                                                        <div className="w-full py-3 border border-red-900/50 text-red-500/50 font-black uppercase flex items-center justify-center gap-2">
                                                                            <IconLock /> Restricted
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {view === 'SETTINGS' && (
                                    <div className={`${sCard} h-full animate-fade-in`}>
                                        <h2 className="text-3xl font-black uppercase tracking-widest mb-8 border-l-4 border-[#00FF66] pl-4">System Parameters</h2>
                                        <div className="space-y-6">
                                            <div className="p-6 bg-black/40 border border-white/5">
                                                <div className="text-lg font-black uppercase mb-4 text-[#00FF66]">Rendering Architecture (Post-Processing)</div>
                                                <div className="flex gap-4">
                                                    {['LOW', 'MED', 'HIGH'].map(g => (
                                                        <button key={g} onClick={()=>setProfile(p=>({...p, settings: {...p.settings, graphics: g as any}}))} 
                                                                className={`flex-1 py-4 font-black uppercase border ${profile.settings.graphics === g ? `bg-[#00FF66] text-black border-[#00FF66]` : 'bg-transparent border-white/20 text-white hover:border-[#00FF66]'}`}>
                                                            {g} Fidelity
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== GAME HUD ==================== */}
            {view === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
                    
                    {hud.state === 'SPACE_TRANSITION' && (
                        <div className="absolute top-[20%] left-1/2 -translate-x-1/2 text-white px-12 py-6 font-black text-5xl z-50 animate-bounce tracking-widest text-center" style={{ textShadow: `0 0 30px ${C_ACCENT}` }}>
                            ATMOSPHERIC BREACH DETECTED<br/>
                            <span className="text-2xl mt-4 block text-gray-400">INITIATING CELESTIAL PROTOCOL</span>
                        </div>
                    )}

                    {hud.state === 'DEPLOYED' && (
                        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-8 z-10" style={{ filter: hud.camMode === 'DRONE' ? 'grayscale(80%) sepia(20%) contrast(1.5)' : '' }}>
                            
                            {/* Cinematic Top/Bottom Bars */}
                            <div className="absolute top-0 left-0 right-0 h-[10%] bg-black z-0" />
                            <div className="absolute bottom-0 left-0 right-0 h-[10%] bg-black z-0" />

                            {/* Top HUD */}
                            <div className="relative z-10 flex justify-between items-start mt-[8%]">
                                <div className="flex flex-col gap-4">
                                    <div className={`px-6 py-3 font-black tracking-widest text-lg flex gap-4 bg-[${C_PANEL}]/80 border border-[${C_BORDER_DIM}] backdrop-blur-md uppercase text-white`}>
                                        OPTIC LINK: <span className={`text-[${C_ACCENT}]`}>{hud.camMode}</span>
                                    </div>
                                    <div className={`px-6 py-4 font-bold text-sm flex flex-col gap-2 w-80 uppercase bg-[${C_PANEL}]/80 border border-red-900/50 backdrop-blur-md text-white`}>
                                        <div className="flex justify-between">
                                            <span>Primary Objectives</span>
                                            <span className="text-red-500 font-black">{hud.progress}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-black border border-red-900/30"><div className="h-full bg-red-600 transition-all" style={{width: `${hud.progress}%`}}/></div>
                                    </div>
                                </div>
                                
                                <div className="flex gap-4 pointer-events-auto">
                                    {hud.heroMode === 'AIR' && (
                                        <>
                                            <button onClick={() => engineRef.current?.toggleCamera()} className={`p-4 bg-[${C_PANEL}]/80 border border-[${C_BORDER_DIM}] text-white hover:border-[${C_ACCENT}] hover:text-[${C_ACCENT}] backdrop-blur-md transition-colors`}><IconCamera /></button>
                                            <button onClick={() => engineRef.current?.switchMode()} className={`px-6 py-4 font-black uppercase tracking-widest bg-[${C_PANEL}]/80 border border-[${C_BORDER_DIM}] text-white hover:border-[${C_ACCENT}] hover:text-[${C_ACCENT}] backdrop-blur-md transition-colors`}>Eject / Ground Insert</button>
                                        </>
                                    )}
                                    {hud.heroMode === 'GROUND' && (
                                        <button onClick={() => engineRef.current?.switchMode()} className={`px-6 py-4 font-black uppercase tracking-widest bg-[${C_PANEL}]/80 border border-[${C_BORDER_DIM}] text-white hover:border-[#00aaff] hover:text-[#00aaff] backdrop-blur-md transition-colors`}>Mount Aerospace Vehicle</button>
                                    )}
                                </div>
                            </div>

                            {/* Center Crosshair (If TPS/FPS) */}
                            {(hud.camMode === 'TPS' || hud.camMode === 'FPS') && (
                                <div className="absolute inset-0 flex items-center justify-center opacity-60 pointer-events-none z-10">
                                    <div className={`w-16 h-16 text-[${hud.heroMode === 'AIR'?C_ACCENT:C_DANGER}]`}><IconCrosshair /></div>
                                </div>
                            )}

                            {/* Tactical Mechanics (Bottom) */}
                            <div className="relative z-10 flex justify-between items-end mb-[8%] pointer-events-auto">
                                
                                {/* Movement Joystick */}
                                <div 
                                    className={`w-40 h-40 rounded-full border-2 border-[${C_BORDER_FOCUS}] bg-black/50 backdrop-blur-md touch-none flex items-center justify-center`}
                                    onPointerDown={(e:any) => {
                                        const r = e.currentTarget.getBoundingClientRect();
                                        const update = (ev:any) => {
                                            const dx = ev.clientX - (r.left + r.width/2); const dy = ev.clientY - (r.top + r.height/2);
                                            const rad = r.width/2; const d = Math.min(Math.hypot(dx,dy), rad); const a = Math.atan2(dy,dx);
                                            if(engineRef.current) { engineRef.current.input.x = (Math.cos(a)*d)/rad; engineRef.current.input.y = (-Math.sin(a)*d)/rad; }
                                        };
                                        update(e); e.currentTarget.onpointermove = update;
                                        e.currentTarget.onpointerup = () => { if(engineRef.current) { engineRef.current.input.x=0; engineRef.current.input.y=0; } e.currentTarget.onpointermove = null; };
                                        e.currentTarget.onpointerleave = e.currentTarget.onpointerup;
                                    }}
                                >
                                    <div className={`w-12 h-12 rounded-full bg-[${C_ACCENT}]/80 shadow-[0_0_15px_${C_ACCENT}]`} />
                                </div>

                                {/* Air Controls */}
                                {hud.heroMode === 'AIR' && (
                                    <div className="flex-1 flex justify-center ml-12">
                                        <button 
                                            onPointerDown={()=>engineRef.current&&(engineRef.current.throttleActive=true)} 
                                            onPointerUp={()=>engineRef.current&&(engineRef.current.throttleActive=false)} 
                                            onPointerLeave={()=>engineRef.current&&(engineRef.current.throttleActive=false)} 
                                            className={`px-16 py-6 border-2 border-[${C_ACCENT}] text-[${C_ACCENT}] font-black uppercase text-2xl tracking-widest bg-black/60 hover:bg-[${C_ACCENT}] hover:text-black transition-colors backdrop-blur-md active:scale-95`}
                                        >
                                            Engage Afterburners
                                        </button>
                                    </div>
                                )}

                                {/* Ground Controls */}
                                {hud.heroMode === 'GROUND' && (
                                    <div className="flex-1 flex justify-center gap-6 ml-12">
                                        {[{id:'sprint', l:'جري'}, {id:'crouch', l:'جلوس'}].map(b => (
                                            <button key={b.id}
                                                onPointerDown={()=>engineRef.current&&(engineRef.current.input[b.id as 'sprint'|'crouch']=true)} 
                                                onPointerUp={()=>engineRef.current&&(engineRef.current.input[b.id as 'sprint'|'crouch']=false)} 
                                                onPointerLeave={()=>engineRef.current&&(engineRef.current.input[b.id as 'sprint'|'crouch']=false)} 
                                                className={`px-10 py-5 bg-[${C_PANEL}]/80 border border-[${C_BORDER_DIM}] text-white font-black text-xl uppercase backdrop-blur-md active:bg-white active:text-black`}
                                            >{b.l}</button>
                                        ))}
                                        <button onClick={()=>engineRef.current?.executeDodge()} className={`px-10 py-5 bg-[${C_PANEL}]/80 border border-[${C_BORDER_DIM}] text-white font-black text-xl uppercase backdrop-blur-md active:bg-white active:text-black`}>مراوغة</button>
                                    </div>
                                )}

                                {/* Fire Button */}
                                <div className="flex flex-col items-center gap-4">
                                    <div className={`px-6 py-2 font-black text-sm tracking-widest border border-red-900/50 bg-black/80 text-red-500 uppercase`}>Weapon System Live</div>
                                    <button 
                                        onPointerDown={() => engineRef.current?.fire()} 
                                        className={`w-36 h-36 rounded-full border-4 border-red-600 bg-red-950 shadow-[0_0_30px_rgba(255,0,0,0.5)] flex items-center justify-center text-red-500 active:scale-90 active:bg-red-600 active:text-black transition-all`}
                                    >
                                        <IconCrosshair />
                                    </button>
                                </div>
                                
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ==================== VICTORY OVERLAY ==================== */}
            {view === 'VICTORY' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-50 p-8 vignette cinematic-bars" style={{background: 'rgba(5, 5, 5, 0.95)'}}>
                    <div className={`p-20 flex flex-col items-center text-center max-w-4xl w-full bg-[${C_PANEL}]/80 backdrop-blur-2xl border border-[${C_ACCENT}] shadow-[0_0_40px_rgba(0,255,102,0.1)]`}>
                        <div className={`w-32 h-32 text-[${C_ACCENT}] mb-8`}><IconCrosshair /></div>
                        <h2 className={`text-6xl font-black mb-4 tracking-widest leading-loose text-[${C_ACCENT}] glow-text`}>
                            Sector SECURED
                        </h2>
                        <h3 className="text-2xl font-bold uppercase tracking-widest text-white/50 mb-16">High Value Targets Neutralized. +5000 XP Granted.</h3>
                        <button onClick={()=>setView('MAIN')} className={`w-full py-8 text-3xl font-black tracking-widest bg-white text-black hover:bg-gray-300 transition-colors uppercase outline-none`}>
                            Return To Central Command
                        </button>
                    </div>
                </div>
            )}
            
        </div>
    );
}
