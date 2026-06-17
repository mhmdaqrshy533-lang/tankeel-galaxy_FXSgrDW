import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

// --------------------------------------------------------
// LANDSCAPE GUARD (FORCE ORIENTATION)
// --------------------------------------------------------
const LandscapeGuard = () => {
    const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth);
    useEffect(() => {
        const handleResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    if (!isPortrait) return null;
    return (
        <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col items-center justify-center p-8 text-center text-xl font-bold font-mono">
            <div className="animate-pulse text-red-500 border border-red-500 p-8 shadow-[0_0_20px_rgba(255,0,0,0.5)]">
                يرجى تدوير الجهاز - النظام يعمل بالوضع الأفقي التكتيكي فقط
            </div>
        </div>
    );
};

// --------------------------------------------------------
// CONFIG & PERSISTENCE
// --------------------------------------------------------
const CORE_KEY = "SGRD-99X-HAZBARI";
const MASTER_CARD = "SHARAB-GOLD-V11";

const usePlayerSave = () => {
    const [save, setSave] = useState(() => {
        try {
             const s = localStorage.getItem('DRONE_STRIKE_SAVE');
             return s ? JSON.parse(s) : { credits: 0, skin: 'STANDARD', score: 0 };
        } catch { return { credits: 0, skin: 'STANDARD', score: 0 }; }
    });
    
    useEffect(() => {
        localStorage.setItem('DRONE_STRIKE_SAVE', JSON.stringify(save));
    }, [save]);

    return [save, setSave] as const;
};

// --------------------------------------------------------
// MATH & PROCEDURAL NOISE
// --------------------------------------------------------
const p = new Uint8Array(512);
let seed = 12345;
function random() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
}
for (let i = 0; i < 256; i++) {
  p[i] = Math.floor(random() * 256);
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
// WEBGL TACTICAL ENGINE
// --------------------------------------------------------
type EntityType = 'TANK' | 'ALIEN' | 'SOLDIER';
type ViewMode = 'DRONE_EARTH' | 'DRONE_SPACE' | 'GROUND_FPS';

interface Entity {
    id: number;
    type: EntityType;
    mesh: THREE.Object3D;
    hp: number;
    maxHp: number;
    active: boolean;
    velocity?: THREE.Vector3;
}

class TacticalEngine {
    public canvas: HTMLCanvasElement;
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    
    public clock: THREE.Clock;
    public state = {
        view: 'DRONE_EARTH' as ViewMode,
        dronePos: new THREE.Vector3(0, 3000, 0),
        fpsPos: new THREE.Vector3(0, 0, 0),
        fpsYaw: 0, fpsPitch: 0,
        inputL: {x: 0, y: 0},
        inputR: {x: 0, y: 0},
        health: 100, ammo: 300, score: 0,
        recoil: 0,
        flashAlpha: 0,
        hitMarker: 0,
    };
    
    public trackingMissile: { mesh: THREE.Mesh, light: THREE.PointLight } | null = null;
    public bullets: { mesh: THREE.Mesh, vel: THREE.Vector3, life: number, type: 'MISSILE' | 'LASER' | 'BULLET', pSystem?: THREE.Points }[] = [];
    public entities: Entity[] = [];
    public clouds!: THREE.Points;
    
    public onSyncHUD: (data: any) => void = () => {};
    public alienOverlayRef: HTMLDivElement | null = null;

    public rtTexture: THREE.WebGLRenderTarget;
    public postScene: THREE.Scene;
    public postCamera: THREE.OrthographicCamera;
    public postMaterial: THREE.ShaderMaterial;

    public gunScene: THREE.Scene;
    public gunCamera: THREE.PerspectiveCamera;
    public gunMesh: THREE.Group;

    constructor(canvas: HTMLCanvasElement, initialView: ViewMode, alienOverlayRef: HTMLDivElement | null) {
        this.canvas = canvas;
        this.state.view = initialView;
        this.alienOverlayRef = alienOverlayRef;
        const w = window.innerWidth; const h = window.innerHeight;
        
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.autoClear = false;
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 15000);
        this.clock = new THREE.Clock();

        const amb = new THREE.AmbientLight(0xffffff, 0.3);
        const dir = new THREE.DirectionalLight(0xffffff, 1.5);
        dir.position.set(2000, 4000, 2000);
        this.scene.add(amb, dir);

        this.gunScene = new THREE.Scene();
        this.gunCamera = new THREE.PerspectiveCamera(45, w/h, 0.01, 100);
        this.gunMesh = new THREE.Group();
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), new THREE.MeshStandardMaterial({color: 0x222222, metalness: 0.8, roughness: 0.2}));
        barrel.position.set(0.3, -0.2, -0.6);
        this.gunMesh.add(barrel);
        this.gunScene.add(this.gunMesh);

        this.rtTexture = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter });
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.postScene = new THREE.Scene();
        this.postMaterial = new THREE.ShaderMaterial({
            uniforms: { tDiffuse: { value: this.rtTexture.texture }, time: { value: 0 }, uMode: { value: 0 } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                uniform sampler2D tDiffuse; uniform float time; uniform int uMode; varying vec2 vUv;
                void main() {
                    vec4 c = texture2D(tDiffuse, vUv);
                    if (uMode == 0) {
                        float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                        vec3 final = mix(vec3(0.05, 0.06, 0.08), vec3(0.4, 0.45, 0.45), smoothstep(0.0, 0.6, luma));
                        if (c.r > 0.8 && c.g > 0.8 && c.b > 0.8) { final = vec3(1.0); } 
                        float noise = fract(sin(dot(vUv * time, vec2(12.9898,78.233))) * 43758.5453);
                        final += noise * 0.05;
                        final -= abs(sin(vUv.y * 800.0)) * 0.03; 
                        gl_FragColor = vec4(final, 1.0);
                    } else if (uMode == 1) {
                        vec3 final = c.rgb;
                        float ro = texture2D(tDiffuse, vUv + vec2(0.003, 0.0)).r;
                        float bo = texture2D(tDiffuse, vUv - vec2(0.003, 0.0)).b;
                        final.r = ro * 1.2; final.g *= 0.8; final.b = bo * 1.5;
                        float scan = sin(vUv.y * 300.0 + time * 5.0) * 0.04;
                        final += scan;
                        gl_FragColor = vec4(final, 1.0);
                    } else {
                        gl_FragColor = c;
                    }
                }
            `
        });
        this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

        this.buildWorld();
        window.addEventListener('resize', this.onResize);
        this.renderer.setAnimationLoop(this.animate);
        this.switchMode(initialView);
    }

    private buildWorld() {
        const tGeo = new THREE.PlaneGeometry(16000, 16000, 200, 200);
        tGeo.rotateX(-Math.PI / 2);
        const pos = tGeo.attributes.position;
        const colors = []; const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i); const z = pos.getZ(i);
            const y = fBm(x, z);
            pos.setY(i, y);
            if (y > 150) c.setHex(0x111111);
            else if (y > 50) c.setHex(0x222222);
            else c.setHex(0x0a0a0a);
            colors.push(c.r, c.g, c.b);
        }
        tGeo.computeVertexNormals();
        tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const terrain = new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true, roughness: 1.0 }));
        this.scene.add(terrain);

        const cloudGeo = new THREE.BufferGeometry();
        const cPos = [];
        for(let i=0; i<1000; i++) {
            cPos.push((Math.random()-0.5)*10000, 2000 + Math.random()*500, (Math.random()-0.5)*10000);
        }
        cloudGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
        const cloudMat = new THREE.PointsMaterial({color: 0xffffff, size: 100, transparent: true, opacity: 0.1, depthWrite: false});
        this.clouds = new THREE.Points(cloudGeo, cloudMat);
        this.scene.add(this.clouds);

        const tankGeo = new THREE.BoxGeometry(20, 15, 30); tankGeo.translate(0, 7.5, 0);
        const tankMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); 

        const alienGeo = new THREE.TetrahedronGeometry(40, 1);
        const alienMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
        
        const soldierGeo = new THREE.CylinderGeometry(2, 2, 8); soldierGeo.translate(0, 4, 0);
        const soldierMat = new THREE.MeshLambertMaterial({ color: 0xaa0000 });

        let id = 0;
        for (let i = 0; i < 200; i++) {
            const x = (Math.random() - 0.5) * 12000; const z = (Math.random() - 0.5) * 12000;
            const y = fBm(x, z);
            
            const tm = new THREE.Mesh(tankGeo, tankMat); tm.position.set(x, y, z);
            this.scene.add(tm);
            this.entities.push({ id: id++, type: 'TANK', mesh: tm, hp: 100, maxHp: 100, active: true });

            const am = new THREE.Mesh(alienGeo, alienMat); am.position.set(x, 1500 + Math.random()*1000, z);
            this.scene.add(am);
            this.entities.push({ id: id++, type: 'ALIEN', mesh: am, hp: 300, maxHp: 300, active: true, velocity: new THREE.Vector3(Math.random()-0.5, 0, Math.random()-0.5).normalize().multiplyScalar(150) });

            const sm = new THREE.Mesh(soldierGeo, soldierMat); sm.position.set(x + 50, fBm(x+50, z+50), z + 50);
            this.scene.add(sm);
            this.entities.push({ id: id++, type: 'SOLDIER', mesh: sm, hp: 40, maxHp: 40, active: true });
        }
        this.state.fpsPos.set(0, fBm(0, 0) + 1.8, 0);
    }

    public fire() {
        if (this.state.view === 'GROUND_FPS') {
            if (this.state.ammo <= 0) return;
            this.state.ammo--; this.state.recoil = 0.2;
            this.syncHUD();
            
            const rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(0,0), this.camera);
            for (let e of this.entities) {
                if (e.active && e.type === 'SOLDIER') {
                    if (rc.ray.distanceSqToPoint(e.mesh.position) < 20) {
                        e.hp -= 40; this.state.hitMarker = 1.0;
                        if (e.hp <= 0) { this.killEntity(e); }
                    }
                }
            }
        } 
        else if (this.state.view === 'DRONE_EARTH') {
            if (this.trackingMissile) return;
            const bGeo = new THREE.CylinderGeometry(2, 2, 20); bGeo.rotateX(Math.PI/2);
            const b = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({color: 0xffaaaa}));
            b.position.copy(this.camera.position); b.position.y -= 20;
            const rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(0,0), this.camera);
            const l = new THREE.PointLight(0xff5500, 2, 500); b.add(l);
            this.trackingMissile = { mesh: b, light: l };
            this.bullets.push({ mesh: b, vel: rc.ray.direction.multiplyScalar(3000), life: 3.0, type: 'MISSILE' });
            this.scene.add(b);
        }
        else if (this.state.view === 'DRONE_SPACE') {
            const bGeo = new THREE.BoxGeometry(2, 2, 50);
            const b = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({color: 0x00ff00}));
            b.position.copy(this.camera.position); b.position.y -= 20;
            const rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(0,0), this.camera);
            this.bullets.push({ mesh: b, vel: rc.ray.direction.multiplyScalar(5000), life: 2.0, type: 'LASER' });
            this.scene.add(b);
        }
    }

    private killEntity(e: Entity) {
        e.active = false; e.mesh.visible = false;
        if(e.type === 'TANK') this.state.score += 500;
        if(e.type === 'ALIEN') this.state.score += 1000;
        if(e.type === 'SOLDIER') this.state.score += 50;
        this.syncHUD();
    }

    private syncHUD() {
        this.onSyncHUD({ 
            health: this.state.health, ammo: this.state.ammo, 
            score: this.state.score, flashAlpha: this.state.flashAlpha,
            hitMarker: this.state.hitMarker, view: this.state.view
        });
    }

    public switchMode(forceMode?: ViewMode) {
        if(forceMode) this.state.view = forceMode;
        else if(this.state.view === 'DRONE_EARTH') this.state.view = 'DRONE_SPACE';
        else if(this.state.view === 'DRONE_SPACE') this.state.view = 'GROUND_FPS';
        else this.state.view = 'DRONE_EARTH';
        
        if (this.state.view === 'GROUND_FPS') {
            this.state.fpsPos.x = this.state.dronePos.x;
            this.state.fpsPos.z = this.state.dronePos.z;
            this.state.fpsPos.y = fBm(this.state.fpsPos.x, this.state.fpsPos.z) + 1.8;
            this.scene.fog = new THREE.FogExp2(0x0a0a0a, 0.001);
        } else if (this.state.view === 'DRONE_EARTH') {
            this.state.dronePos.x = this.state.fpsPos.x;
            this.state.dronePos.z = this.state.fpsPos.z;
            this.scene.fog = null;
        } else {
            this.scene.fog = null;
        }
        this.trackingMissile = null;
        this.syncHUD();
    }

    private animate = () => {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        const time = this.clock.getElapsedTime();

        if (this.state.flashAlpha > 0) { this.state.flashAlpha = Math.max(0, this.state.flashAlpha - dt * 1.5); this.syncHUD(); }
        if (this.state.hitMarker > 0) { this.state.hitMarker = Math.max(0, this.state.hitMarker - dt * 3); this.syncHUD(); }

        if (this.clouds) {
             const points = this.clouds.geometry.attributes.position.array as Float32Array;
             for(let i=0; i<points.length; i+=3) {
                 points[i] += 100 * dt;
                 if(points[i] > 8000) points[i] = -8000;
             }
             this.clouds.geometry.attributes.position.needsUpdate = true;
             this.clouds.visible = this.state.view === 'DRONE_EARTH';
        }

        let alienMarkup = '';
        for(let e of this.entities) {
            if(!e.active) continue;
            e.mesh.visible = true; 
            if (this.state.view === 'DRONE_EARTH' && e.type !== 'TANK') e.mesh.visible = false;
            if (this.state.view === 'DRONE_SPACE' && e.type !== 'ALIEN') e.mesh.visible = false;
            if (this.state.view === 'GROUND_FPS' && e.type !== 'SOLDIER') e.mesh.visible = false;

            if (e.type === 'ALIEN' && e.velocity) {
                e.mesh.position.addScaledVector(e.velocity, dt);
                e.mesh.rotation.x += dt; e.mesh.rotation.y += dt;
                if(Math.abs(e.mesh.position.x) > 6000) e.velocity.x *= -1;
                if(Math.abs(e.mesh.position.z) > 6000) e.velocity.z *= -1;

                if(this.state.view === 'DRONE_SPACE') {
                    const p = e.mesh.position.clone().project(this.camera);
                    if(p.z < 1) {
                        const x = (p.x * 0.5 + 0.5) * window.innerWidth;
                        const y = (-(p.y * 0.5) + 0.5) * window.innerHeight;
                        alienMarkup += `<div style="position:absolute; left:${x-20}px; top:${y-20}px; width:40px; height:40px; border: 1px solid #00ffff; pointer-events:none;">
                            <div style="position:absolute; top:-6px; width:100%; height:3px; background:#a00;">
                                 <div style="height:100%; background:#0ff; width:${(e.hp/e.maxHp)*100}%"></div>
                            </div>
                        </div>`;
                    }
                }
            }
        }
        if (this.alienOverlayRef) this.alienOverlayRef.innerHTML = alienMarkup;

        if (this.state.view === 'DRONE_EARTH' || this.state.view === 'DRONE_SPACE') {
            const speed = 1500 * dt;
            this.state.dronePos.x += this.state.inputL.x * speed;
            this.state.dronePos.z += this.state.inputL.y * speed;
            
            if (this.trackingMissile && this.state.view === 'DRONE_EARTH') {
                const mp = this.trackingMissile.mesh.position;
                this.camera.position.lerp(new THREE.Vector3(mp.x, mp.y + 250, mp.z + 250), 10 * dt);
                this.camera.lookAt(mp);
            } else {
                this.camera.position.copy(this.state.dronePos);
                this.camera.position.x += this.state.inputR.x * 800;
                this.camera.position.z += this.state.inputR.y * 800;
                this.camera.lookAt(this.state.dronePos.x, 0, this.state.dronePos.z);
            }
            this.postMaterial.uniforms.uMode.value = this.state.view === 'DRONE_EARTH' ? 0 : 1;
        } else {
            const moveSpeed = 80 * dt; const rotSpeed = 2.5 * dt;
            this.state.fpsYaw -= this.state.inputR.x * rotSpeed;
            this.state.fpsPitch += this.state.inputR.y * rotSpeed;
            this.state.fpsPitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.state.fpsPitch));
            
            const fwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), this.state.fpsYaw);
            const right = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), this.state.fpsYaw);
            
            this.state.fpsPos.add(fwd.multiplyScalar(-this.state.inputL.y * moveSpeed));
            this.state.fpsPos.add(right.multiplyScalar(this.state.inputL.x * moveSpeed));
            
            const gy = fBm(this.state.fpsPos.x, this.state.fpsPos.z);
            this.state.fpsPos.y = THREE.MathUtils.lerp(this.state.fpsPos.y, gy + 1.8, dt * 15);
            
            this.camera.position.copy(this.state.fpsPos);
            this.camera.rotation.set(this.state.fpsPitch, this.state.fpsYaw, 0, 'YXZ');
            
            const swayX = Math.sin(time * 6) * 0.02 * (Math.abs(this.state.inputL.x) + Math.abs(this.state.inputL.y));
            const swayY = Math.cos(time * 12) * 0.02 * (Math.abs(this.state.inputL.x) + Math.abs(this.state.inputL.y));
            this.gunMesh.position.set(0.3 + swayX, -0.2 + swayY, -0.6 + this.state.recoil);
            if (this.state.recoil > 0) this.state.recoil = Math.max(0, this.state.recoil - dt * 3.0);
            this.postMaterial.uniforms.uMode.value = 2;
        }

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.life -= dt;
            b.mesh.position.addScaledVector(b.vel, dt);
            
            let hit = false;
            let groundY = fBm(b.mesh.position.x, b.mesh.position.z);
            if (b.life <= 0 || b.mesh.position.y < groundY) hit = true;
            
            if (!hit) {
                for (let e of this.entities) {
                    if (e.active && e.mesh.visible) {
                        const dist = e.type === 'ALIEN' ? 50 : 20;
                        if (e.mesh.position.distanceTo(b.mesh.position) < dist) {
                            e.hp -= (b.type === 'MISSILE' ? 100 : 50); hit = true;
                            if (e.hp <= 0) this.killEntity(e);
                            break;
                        }
                    }
                }
            }
            if (hit) {
                if (b.type === 'MISSILE' && this.trackingMissile && this.trackingMissile.mesh === b.mesh) {
                    this.state.flashAlpha = 1.0;
                    this.trackingMissile = null;
                    this.syncHUD();
                    for(let e of this.entities) {
                        if(e.active && e.type==='TANK' && e.mesh.position.distanceTo(b.mesh.position) < 300) this.killEntity(e);
                    }
                }
                this.scene.remove(b.mesh);
                this.bullets.splice(i, 1);
            }
        }

        if (this.state.view === 'DRONE_EARTH' || this.state.view === 'DRONE_SPACE') {
            this.renderer.setRenderTarget(this.rtTexture);
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            this.renderer.setRenderTarget(null);
            this.postMaterial.uniforms.time.value = time;
            this.renderer.render(this.postScene, this.postCamera);
        } else {
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            this.renderer.clearDepth();
            this.renderer.render(this.gunScene, this.gunCamera);
        }
    };
    
    private onResize = () => {
        const w = window.innerWidth; const h = window.innerHeight;
        this.renderer.setSize(w, h);
        if(this.rtTexture) this.rtTexture.setSize(w, h);
        this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
        this.gunCamera.aspect = w/h; this.gunCamera.updateProjectionMatrix();
    };
    
    public dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
        this.rtTexture.dispose();
    }
}

// --------------------------------------------------------
// REACT COMPONENTS
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
             className={`absolute bottom-8 w-32 h-32 rounded-full border-2 border-white/20 bg-black/30 touch-none backdrop-blur-sm flex items-center justify-center pointer-events-auto z-40 ${side === 'left' ? 'left-8' : 'right-40'}`}
             onPointerDown={handlePointerMove} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}>
             <div ref={stickRef} className="w-12 h-12 rounded-full bg-white/50 shadow-[0_0_15px_rgba(255,255,255,0.8)] pointer-events-none transition-transform duration-75" />
        </div>
    );
}

const IntroSequence = ({ onComplete }: { onComplete: () => void }) => {
    const [text, setText] = useState("");
    useEffect(() => {
        let step = 0;
        const sequence = [
            "جاري فحص الاتصال التكتيكي المحلي...",
            "تحليل البيانات الطبوغرافية...",
            "تشفير الإحداثيات...",
            "تأكيد بروتوكول التشغيل الأوفلاين... نَشِط"
        ];
        const int = setInterval(() => {
            if (step >= sequence.length) {
                clearInterval(int);
                setTimeout(onComplete, 500);
            } else {
                setText(sequence[step]);
                step++;
            }
        }, 800);
        return () => clearInterval(int);
    }, []);

    return (
        <div className="absolute inset-0 bg-black flex items-center justify-center font-mono text-green-500 text-xl tracking-widest pointer-events-none z-50">
            {text}
            <div className="w-2 h-6 bg-green-500 animate-pulse inline-block ml-2 align-middle" />
        </div>
    );
};

export default function App() {
    const [appState, setAppState] = useState<'AUTH' | 'INTRO' | 'MENU' | 'STORE' | 'GAME'>('AUTH');
    const [viewMode, setViewMode] = useState<ViewMode>('DRONE_EARTH');
    const [save, setSave] = usePlayerSave();
    
    const [authCode, setAuthCode] = useState("");
    const [authErr, setAuthErr] = useState(false);
    
    const [storeCode, setStoreCode] = useState("");
    const [storeMsg, setStoreMsg] = useState("");

    const [hud, setHud] = useState({ view: 'DRONE_EARTH', health: 100, ammo: 300, score: 0, flashAlpha: 0, hitMarker: 0 });
    
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);

    const checkAuth = (e: React.FormEvent) => {
        e.preventDefault();
        if (authCode === CORE_KEY) {
            setAppState('INTRO');
        } else {
            setAuthErr(true); setTimeout(() => setAuthErr(false), 1000);
        }
    };

    const redeemCard = (e: React.FormEvent) => {
        e.preventDefault();
        if (storeCode === MASTER_CARD) {
            setSave({ ...save, credits: 999999, skin: 'العقاب الذهبي' });
            setStoreMsg("تم تفعيل كارت الشحن بنجاح! الذخيرة النووية جاهزة الآن");
        } else {
            setStoreMsg("كود التفعيل غير صالح والعملية قيد المراقبة");
        }
    };

    const runMission = (mode: ViewMode) => {
        setViewMode(mode);
        setAppState('GAME');
    };

    useEffect(() => {
        if (appState === 'GAME' && canvasRef.current && !engineRef.current) {
            engineRef.current = new TacticalEngine(canvasRef.current, viewMode, overlayRef.current);
            engineRef.current.onSyncHUD = (data) => setHud(prev => ({...prev, ...data}));
        }
        return () => {
            if (appState !== 'GAME' && engineRef.current) {
                setSave(s => ({...s, score: s.score + hud.score}));
                engineRef.current.dispose();
                engineRef.current = null;
            }
        };
    }, [appState]);

    const handleInputL = useCallback((x: number, y: number) => { if (engineRef.current) engineRef.current.state.inputL = { x, y }; }, []);
    const handleInputR = useCallback((x: number, y: number) => { if (engineRef.current) engineRef.current.state.inputR = { x, y }; }, []);

    return (
        <div className="w-screen h-screen bg-black overflow-hidden font-mono select-none" dir="rtl">
            <LandscapeGuard />

            {appState === 'AUTH' && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
                    <div className="w-96 p-8 border border-white/20 bg-black/80 backdrop-blur-md shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                        <h1 className="text-2xl font-bold text-white mb-6 text-center tracking-widest">منصة التشفير السيادي</h1>
                        <form onSubmit={checkAuth} className="flex flex-col gap-4">
                            <input type="text" value={authCode} onChange={e => setAuthCode(e.target.value.toUpperCase())}
                                placeholder="ACCESS CODE" dir="ltr"
                                className={`w-full bg-transparent border-b-2 ${authErr ? 'border-red-500 text-red-500' : 'border-white text-white'} p-2 text-center text-xl outline-none tracking-widest uppercase transition-colors`} />
                            <button type="submit" className="w-full bg-white text-black font-bold py-3 mt-4 hover:bg-gray-200 transition-colors">تحقق من الصلاحيات</button>
                        </form>
                    </div>
                </div>
            )}

            {appState === 'INTRO' && <IntroSequence onComplete={() => setAppState('MENU')} />}

            {appState === 'MENU' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900">
                    <div className="absolute top-4 right-4 text-green-500 font-bold border border-green-500 p-2">
                        الاعتمادات العسكرية: {save.credits} | النقاط: {save.score}
                    </div>
                    <h1 className="text-4xl text-white font-bold mb-10 tracking-widest text-center shadow-black drop-shadow-lg">غرفة التخطيط والاستراتيجية</h1>
                    <div className="flex flex-col gap-4 w-80">
                        <button onClick={() => runMission('DRONE_EARTH')} className="w-full bg-white text-black font-bold py-4 hover:bg-gray-300 transition-colors">بدء الهجوم الجوي التكتيكي</button>
                        <button onClick={() => runMission('GROUND_FPS')} className="w-full border border-white/50 text-white font-bold py-4 hover:bg-white/10 transition-colors">النزول الميداني وتطهير الخنادق</button>
                        <button onClick={() => setAppState('STORE')} className="w-full border border-yellow-500 text-yellow-500 font-bold py-4 hover:bg-yellow-500/20 transition-colors">مخزن العتاد والتسليح الرقمي</button>
                    </div>
                </div>
            )}

            {appState === 'STORE' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-50">
                     <h2 className="text-3xl text-white font-bold mb-8 tracking-widest text-center">شحن العتاد عبر الكروت المحلية</h2>
                     <form onSubmit={redeemCard} className="flex flex-col gap-4 w-96">
                          <input type="text" value={storeCode} onChange={e=>setStoreCode(e.target.value.toUpperCase())} placeholder="أدخل رمز الشحن" dir="ltr"
                                 className="w-full bg-black border border-white/40 p-4 text-center text-xl text-yellow-400 font-bold outline-none uppercase" />
                          <button type="submit" className="w-full bg-yellow-600 text-black font-bold py-4 hover:bg-yellow-500 transition-colors">تفعيل بروتوكول الإمداد</button>
                          <button type="button" onClick={() => setAppState('MENU')} className="w-full bg-black border border-white/50 text-white font-bold py-4 hover:bg-white/10 mt-4">عودة لقاعدة التخطيط</button>
                          {storeMsg && <div className="mt-4 text-center text-lg font-bold text-white bg-black/50 p-4 border border-white/30">{storeMsg}</div>}
                     </form>
                </div>
            )}

            {appState === 'GAME' && (
                <>
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
                    <div ref={overlayRef} className="absolute inset-0 pointer-events-none z-10" />
                    
                    <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between p-4 font-mono select-none">
                        <div className="absolute inset-0 bg-white pointer-events-none transition-opacity duration-75" style={{opacity: hud.flashAlpha, zIndex: 9999}} />
                        
                        {hud.hitMarker > 0 && (
                             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 pointer-events-none opacity-80" style={{transform: `translate(-50%, -50%) scale(${1 + hud.hitMarker})`}}>
                                  <div className="absolute top-0 left-0 w-full h-full"> 
                                       <div className="absolute top-1/2 left-0 w-full h-[2px] bg-red-500 rotate-45" />
                                       <div className="absolute top-1/2 left-0 w-full h-[2px] bg-red-500 -rotate-45" />
                                  </div>
                             </div>
                        )}

                        <div className="flex justify-between items-start pointer-events-auto">
                            <div className="flex flex-col gap-2">
                                {hud.view === 'GROUND_FPS' ? (
                                    <>
                                        <div className="bg-black/80 border border-white/20 p-2 px-4 w-72">
                                            <div className="text-xs text-white/50 mb-1 font-bold">مؤشر سلامة الهيكل العسكري: {hud.health}%</div>
                                            <div className="w-full h-3 bg-red-900/50 relative overflow-hidden">
                                                <div className="absolute top-0 left-0 h-full bg-green-500 transition-all" style={{width: `${Math.max(0, hud.health)}%`}} />
                                            </div>
                                        </div>
                                        <div className="text-xl font-bold text-white bg-black/80 px-4 py-2 border border-white/20 w-72" dir="ltr">
                                            AMMO: {hud.ammo}
                                        </div>
                                    </>
                                ) : (
                                    <div className="bg-black/80 border border-white/20 p-2 px-4 w-72">
                                        <div className="text-sm font-bold tracking-widest text-center text-green-400">
                                            {hud.view === 'DRONE_EARTH' ? 'FLIR OPTICS // TACTICAL' : 'COSMIC TARGETING // SPACE'}
                                        </div>
                                    </div>
                                )}
                                <div className="bg-black/80 text-yellow-500 font-bold px-4 py-2 mt-2 border border-white/20 tracking-widest text-center w-72">
                                    الاعتمادات الميدانية: {hud.score}
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <button onClick={() => engineRef.current?.switchMode()} className="bg-black/80 text-white font-bold py-2 px-6 border border-white/30 hover:bg-white hover:text-black pointer-events-auto transition-colors">
                                    التبديل التكتيكي للرؤية
                                </button>
                                <button onClick={() => setAppState('MENU')} className="bg-red-800/90 text-white font-bold py-2 px-6 border border-red-500 hover:bg-red-600 pointer-events-auto shadow-[0_0_10px_rgba(255,0,0,0.5)] transition-colors">
                                    إخلاء الموقع
                                </button>
                            </div>
                        </div>

                        {(hud.view === 'DRONE_EARTH' || hud.view === 'DRONE_SPACE') && (
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 border border-white/30 flex items-center justify-center pointer-events-none">
                                <div className="absolute top-0 w-0.5 h-6 bg-white" />
                                <div className="absolute bottom-0 w-0.5 h-6 bg-white" />
                                <div className="absolute left-0 w-6 h-0.5 bg-white" />
                                <div className="absolute right-0 w-6 h-0.5 bg-white" />
                                <div className="w-1 h-1 bg-red-500 rounded-full" />
                            </div>
                        )}
                        {hud.view === 'GROUND_FPS' && (
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center justify-center">
                                 <div className="w-1 h-4 bg-green-400 opacity-80 mb-4" />
                                 <div className="flex gap-4">
                                     <div className="w-4 h-1 bg-green-400 opacity-80" />
                                     <div className="w-1 h-1 bg-green-400" />
                                     <div className="w-4 h-1 bg-green-400 opacity-80" />
                                 </div>
                                 <div className="w-1 h-4 bg-green-400 opacity-80 mt-4" />
                            </div>
                        )}
                        
                        <div className="flex justify-between items-end pb-8 px-4 h-1/2 w-full pointer-events-none">
                            <Joystick side="left" onMove={handleInputL} />
                            <Joystick side="right" onMove={handleInputR} />
                            <button onPointerDown={(e) => { e.stopPropagation(); engineRef.current?.fire(); }} 
                                    className="absolute right-8 bottom-8 pointer-events-auto rounded-full w-24 h-24 bg-red-600/80 border-4 border-white/80 shadow-[0_0_30px_rgba(255,0,0,0.6)] active:bg-red-400 active:scale-95 transition-all outline-none flex items-center justify-center">
                                <span className="text-white font-bold tracking-widest text-xl">{hud.view === 'GROUND_FPS' ? 'FIRE' : 'LAUNCH'}</span>
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
