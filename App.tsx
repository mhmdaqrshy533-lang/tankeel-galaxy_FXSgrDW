import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';

// --------------------------------------------------------
// 1. CONSTANTS & SYSTEM DICTIONARY
// --------------------------------------------------------
const ACTIVATION_CODES = ["SGRD-99X-HAZBARI"];
const OFFLINE_VOUCHERS: Record<string, {type: "skin"|"ammo", name: string}> = {
  "SHARAB-GOLD-V10": { type: "skin", name: "المقاتلة الذهبية المستدامة" }
};

interface SaveState {
    pilotName: string; crystals: number; score: number;
    upgrades: { plasma: number; missiles: number; engine: number; };
    unlockedSkins: string[]; infiniteAmmo: boolean;
    lastLuckyWheelTimestamp: number;
}
const DEFAULT_SAVE: SaveState = {
    pilotName: "طيار مجهول", crystals: 0, score: 0,
    upgrades: { plasma: 1, missiles: 1, engine: 1 }, unlockedSkins: [],
    infiniteAmmo: false, lastLuckyWheelTimestamp: 0
};

// --------------------------------------------------------
// 2. AUDIO SYNTHESIS ENGINE
// --------------------------------------------------------
let audioCtx: AudioContext | null = null;
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playHaptic(type: 'laser' | 'explosion' | 'click' | 'upgrade') {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    if (type === 'laser') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'explosion') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.5);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    } else if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.05);
        osc.start(now); osc.stop(now + 0.05);
    } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    }
}

// --------------------------------------------------------
// 3. PROCEDURAL TERRAIN
// --------------------------------------------------------
function terrainNoise(x: number, z: number) {
    let y = 0; let amp = 300; let freq = 0.001;
    for (let j = 0; j < 4; j++) {
        y += Math.sin(x * freq) * Math.cos(z * freq) * amp;
        y += Math.abs(Math.sin(x * freq * 2 + z * freq * 2)) * amp * 0.2;
        amp *= 0.4; freq *= 2.5;
    }
    return y;
}

// --------------------------------------------------------
// 4. GRAPHIC ENGINE
// --------------------------------------------------------
class GraphicEngine {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private droneCamera!: THREE.OrthographicCamera;
  private fgScene!: THREE.Scene;
  private fgCamera!: THREE.PerspectiveCamera;
  private terrain!: THREE.Mesh;
  private buildings!: THREE.InstancedMesh;
  private enemyTowers: { mesh: THREE.Mesh, hp: number, active: boolean }[] = [];
  private clock = new THREE.Clock();
  private bullets: THREE.Mesh[] = [];
  private input = { thrust: 0, yaw: 0, pitch: 0, roll: 0 };
  private gunMesh!: THREE.Group;
  
  public appMode: 'HANGAR' | 'GAME' = 'HANGAR';
  public combatPhase: 'DRONE' | 'GROUND_FPS' = 'DRONE';
  public shipHealth = 100;
  
  // Drone Mode Internals
  private rtTexture!: THREE.WebGLRenderTarget;
  private postScene!: THREE.Scene;
  private postCamera!: THREE.OrthographicCamera;
  private postMaterial!: THREE.ShaderMaterial;
  private flashIntensity = 0;
  private cameraShake = 0;
  private droneCenter = new THREE.Vector3(0, 0, 0); 
  
  // FPS Internals
  public fpsHealth = 100;
  public fpsAmmo = 30;
  private fpsPlayer = { position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0 };

  public onScore: (score: number, crystals: number) => void = () => {};
  public onRetreat: () => void = () => {};
  public onHudUpdate: (data: any) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.init();
  }

  private init() {
    let w = window.innerWidth; let h = window.innerHeight;
    if (w < h) { [w, h] = [h, w]; }

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020304);
    this.scene.fog = new THREE.FogExp2(0x1a1512, 0.0003);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 25000);
    
    let aspect = w/h;
    let d = 1000;
    this.droneCamera = new THREE.OrthographicCamera(-d*aspect, d*aspect, d, -d, 1, 15000);
    this.droneCamera.position.set(0, 4000, 0);
    this.droneCamera.lookAt(0,0,0);

    this.fgScene = new THREE.Scene();
    this.fgCamera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    this.fgCamera.position.set(0, 5, 15);
    this.fgCamera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    const dirLight = new THREE.DirectionalLight(0x00ffff, 1.5);
    dirLight.position.set(50, 100, 50);
    this.scene.add(ambientLight.clone(), dirLight.clone());
    this.fgScene.add(ambientLight, dirLight);

    // FLIR Post Processing
    this.rtTexture = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter });
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene = new THREE.Scene();
    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rtTexture.texture }, time: { value: 0 }, flash: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float time; uniform float flash; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          vec3 final = vec3(lum * 0.5);
          if (c.r > 0.5 && c.g < 0.2 && c.b < 0.2) final = vec3(1.0); // FLIR Highlight
          final += fract(sin(dot(vUv * time, vec2(12.9898, 78.233))) * 43758.5453) * 0.05;
          final -= sin(vUv.y * 800.0) * 0.02;
          final += flash;
          gl_FragColor = vec4(final, 1.0);
        }
      `
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

    this.createTerrain();
    this.createEnemies();
    this.createFPSGun();
    
    window.addEventListener('resize', this.onWindowResize);
    this.renderer.setAnimationLoop(this.animate);
  }

  private createTerrain() {
    const size = 30000; const segments = 150;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    const colors = []; const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const z = pos.getZ(i);
        let y = terrainNoise(x, z);
        if (y < -100) y = -100 + (y + 100) * 0.2;
        y -= 400; 
        pos.setY(i, y);
        
        if (y > -150) color.setHex(0x3a2f2a);
        else if (y < -450) color.setHex(0x1a1512);
        else color.setHex(0x2a1f1a);
        colors.push(color.r, color.g, color.b);
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 }));
    this.scene.add(this.terrain);

    const bGeo = new THREE.BoxGeometry(20, 20, 20); bGeo.translate(0, 10, 0);
    this.buildings = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1.0 }), 1000);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 1000; i++) {
        const x = (Math.random() - 0.5) * 8000; const z = (Math.random() - 0.5) * 8000 - 4000;
        let y = terrainNoise(x, z);
        if (y < -100) y = -100 + (y + 100) * 0.2;
        y -= 400;
        if (y < -400) {
            dummy.position.set(x, y, z);
            dummy.scale.set(1 + Math.random()*2, 1 + Math.random()*4, 1 + Math.random()*2);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.updateMatrix();
            this.buildings.setMatrixAt(i, dummy.matrix);
        } else {
             dummy.position.set(0, -9999, 0); dummy.updateMatrix(); this.buildings.setMatrixAt(i, dummy.matrix);
        }
    }
    this.scene.add(this.buildings);
  }

  private createEnemies() {
      const g = new THREE.CylinderGeometry(5, 10, 40, 8); g.translate(0, 20, 0);
      const m = new THREE.MeshStandardMaterial({ color: 0xFF0000, roughness: 0.5, metalness: 0.8 });
      for(let i=0; i<150; i++) {
          const mesh = new THREE.Mesh(g, m);
          const x = (Math.random() - 0.5) * 8000; const z = (Math.random() - 0.5) * 8000;
          let y = terrainNoise(x, z) - 400;
          if (y < -200) y = -200; 
          mesh.position.set(x, y, z);
          this.scene.add(mesh);
          this.enemyTowers.push({ mesh, hp: 100, active: true });
      }
  }

  private createFPSGun() {
      this.gunMesh = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), new THREE.MeshStandardMaterial({color: 0x333333}));
      barrel.position.set(0.3, -0.3, -0.8);
      
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3), new THREE.MeshStandardMaterial({color: 0x111111}));
      scope.rotation.x = Math.PI/2;
      scope.position.set(0.3, -0.2, -0.7);
      
      this.gunMesh.add(barrel, scope);
      this.fgScene.add(this.gunMesh);
      this.gunMesh.visible = false;
  }

  public setInput(input: any) { this.input = { ...this.input, ...input }; }

  public togglePhase() {
      this.setPhase(this.combatPhase === 'DRONE' ? 'GROUND_FPS' : 'DRONE');
  }

  public setPhase(phase: 'DRONE'|'GROUND_FPS') {
      this.combatPhase = phase;
      this.onHudUpdate({ phase: this.combatPhase });
      this.gunMesh.visible = (phase === 'GROUND_FPS');
      if (phase === 'GROUND_FPS') {
          this.fpsPlayer.position.set(this.droneCenter.x, 0, this.droneCenter.z);
          this.fpsAmmo = 30; this.fpsHealth = 100;
          this.onHudUpdate({ health: 100, ammo: 30 });
      } else {
          this.droneCenter.set(this.fpsPlayer.position.x, 0, this.fpsPlayer.position.z);
      }
  }

  public requestAirSupport() {
      if (this.combatPhase !== 'GROUND_FPS') return;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      const pos = raycaster.ray.at(1000, new THREE.Vector3()); 
      
      const mGeo = new THREE.CylinderGeometry(4, 4, 20); mGeo.rotateX(Math.PI/2);
      const missile = new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({color: 0xFF00FF}));
      missile.position.set(pos.x, pos.y + 1500, pos.z);
      missile.userData = { target: pos, speed: 2000, type: 'airstrike' };
      this.scene.add(missile); this.bullets.push(missile);
  }

  public fire() {
      if (this.combatPhase === 'GROUND_FPS') {
          if (this.fpsAmmo <= 0) return;
          this.fpsAmmo--; this.onHudUpdate({ ammo: this.fpsAmmo });
          playHaptic('laser');

          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
          
          for (let t of this.enemyTowers) {
              if (t.active && raycaster.ray.distanceSqToPoint(t.mesh.position) < 400) {
                  t.hp -= 34;
                  if (t.hp <= 0) {
                      t.active = false; t.mesh.position.y = -9999;
                      this.onScore(100, 1);
                  }
              }
          }
          const pl = new THREE.PointLight(0xffdd00, 2, 20); pl.position.set(0.3, -0.3, -1.2);
          this.gunMesh.add(pl); setTimeout(() => this.gunMesh.remove(pl), 50);
          
      } else if (this.combatPhase === 'DRONE') {
          playHaptic('laser'); this.cameraShake = 0.5;
          const mGeo = new THREE.CylinderGeometry(2, 2, 10); mGeo.rotateX(Math.PI/2);
          const missile = new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({color: 0xFFFFFF}));
          missile.position.copy(this.droneCamera.position); missile.position.y -= 50;
          
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(0, 0), this.droneCamera);
          const targetPoint = raycaster.ray.at(4000, new THREE.Vector3());
          
          missile.userData = { target: targetPoint, speed: 3000, type: 'drone_missile' };
          this.scene.add(missile); this.bullets.push(missile);
      }
  }

  private addDebris(pos: THREE.Vector3) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({color: 0xffffff}));
      s.position.copy(pos);
      s.userData = { velocity: new THREE.Vector3((Math.random()-0.5)*200, Math.random()*200, (Math.random()-0.5)*200), life: 1.5, type: 'debris' };
      this.scene.add(s); this.bullets.push(s);
  }

  private animate = () => {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsedTime();

    if (this.appMode === 'GAME') {
        if (this.combatPhase === 'DRONE') {
            this.droneCenter.x += this.input.yaw * 1500 * dt; 
            this.droneCenter.z -= this.input.thrust * 1500 * dt; 
            
            this.droneCamera.position.set(this.droneCenter.x, 3000, this.droneCenter.z);
            if (this.cameraShake > 0) {
                 this.droneCamera.position.x += (Math.random()-0.5)*this.cameraShake*50;
                 this.droneCamera.position.z += (Math.random()-0.5)*this.cameraShake*50;
                 this.cameraShake *= 0.9;
                 if (this.cameraShake < 0.01) this.cameraShake = 0;
            }

        } else if (this.combatPhase === 'GROUND_FPS') {
            const speed = 100 * dt;
            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), this.fpsPlayer.yaw);
            const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0,1,0), this.fpsPlayer.yaw);
            
            this.fpsPlayer.position.add(forward.multiplyScalar(this.input.thrust * speed));
            this.fpsPlayer.position.add(right.multiplyScalar(this.input.yaw * speed));

            let groundHeight = terrainNoise(this.fpsPlayer.position.x, this.fpsPlayer.position.z);
            if (groundHeight < -100) groundHeight = -100 + (groundHeight + 100) * 0.2;
            groundHeight -= 400;

            this.fpsPlayer.position.y = THREE.MathUtils.lerp(this.fpsPlayer.position.y, groundHeight + 4.0, dt*4);

            this.camera.position.copy(this.fpsPlayer.position);
            this.fpsPlayer.yaw -= this.input.roll * dt * 2.0;
            this.fpsPlayer.pitch += this.input.pitch * dt * 2.0;
            this.fpsPlayer.pitch = THREE.MathUtils.clamp(this.fpsPlayer.pitch, -Math.PI/2, Math.PI/2);
            this.camera.rotation.set(this.fpsPlayer.pitch, this.fpsPlayer.yaw, 0, 'YXZ');
            
            this.gunMesh.position.set(0.3, -0.3 + Math.sin(time*10)*0.01*(Math.abs(this.input.thrust)+Math.abs(this.input.yaw)), -0.8);
        }

        // Bullets process
        for(let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            if (b.userData.type === 'debris') {
                b.userData.life -= dt; b.userData.velocity.y -= 300 * dt; 
                b.position.addScaledVector(b.userData.velocity, dt); b.rotation.x += dt * 5; b.rotation.y += dt * 5;
                if (b.userData.life <= 0 || b.position.y < -500) { this.scene.remove(b); this.bullets.splice(i, 1); }
            } else if (b.userData.type === 'drone_missile' || b.userData.type === 'airstrike') {
                const dir = new THREE.Vector3().subVectors(b.userData.target, b.position);
                const dist = dir.length(); dir.normalize();
                const step = Math.min(dist, dt * b.userData.speed);
                b.position.add(dir.multiplyScalar(step)); b.lookAt(b.userData.target);

                if (dist < 20) {
                    this.flashIntensity = 1.0; playHaptic('explosion');
                    for(let k=0; k<25; k++) this.addDebris(b.position);
                    this.scene.remove(b); this.bullets.splice(i, 1);
                    for(let j=0; j<this.enemyTowers.length; j++) {
                        const tower = this.enemyTowers[j];
                        if (tower.active && tower.mesh.position.distanceTo(b.userData.target) < 200) {
                            tower.hp -= 100;
                            if (tower.hp <= 0) { tower.active = false; tower.mesh.position.y = -9999; this.onScore(1500, Math.floor(Math.random()*5)+5); }
                        }
                    }
                }
            }
        }
        
        // Enemies AI
        for(let j=0; j<this.enemyTowers.length; j++) {
            const t = this.enemyTowers[j];
            if (t.active) {
                if (this.combatPhase === 'GROUND_FPS') {
                    const dist = t.mesh.position.distanceTo(this.fpsPlayer.position);
                    if (dist < 300 && Math.random() < 0.01) {
                        this.fpsHealth -= 5;
                        if (this.fpsHealth <= 0) { this.onHudUpdate({health: 0}); this.onRetreat(); }
                        else { this.onHudUpdate({health: this.fpsHealth}); this.flashIntensity = 0.3; }
                    }
                } else {
                    t.mesh.position.x += (Math.random()-0.5)*10*dt;
                    t.mesh.position.z += (Math.random()-0.5)*10*dt;
                    let gy = terrainNoise(t.mesh.position.x, t.mesh.position.z);
                    if(gy < -100) gy = -100 + (gy+100)*0.2;
                    t.mesh.position.y = gy - 400 + 20;
                }
            }
        }

        // Render pass
        if (this.combatPhase === 'DRONE') {
            this.renderer.setRenderTarget(this.rtTexture);
            this.renderer.clear();
            this.renderer.render(this.scene, this.droneCamera);
            this.renderer.setRenderTarget(null);
            
            if (this.flashIntensity > 0) {
                this.flashIntensity -= dt * 2;
                if(this.flashIntensity < 0) this.flashIntensity = 0;
            }
            this.postMaterial.uniforms.flash.value = this.flashIntensity;
            this.postMaterial.uniforms.time.value = time;
            this.renderer.render(this.postScene, this.postCamera);
            
            this.renderer.clearDepth();
            this.renderer.render(this.fgScene, this.fgCamera);
        } else {
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            if (this.flashIntensity > 0) {
                this.flashIntensity -= dt * 3;
                if (this.flashIntensity < 0) this.flashIntensity = 0;
                this.renderer.setScissorTest(true);
                this.renderer.setScissor(0,0,window.innerWidth, window.innerHeight);
                this.renderer.setClearColor(new THREE.Color(0xff0000), this.flashIntensity * 0.5);
                this.renderer.clearColor();
                this.renderer.setScissorTest(false);
                this.renderer.setClearColor(new THREE.Color(0x020304), 1);
            }
            this.renderer.clearDepth();
            this.renderer.render(this.fgScene, this.fgCamera);
        }
    } else {
         this.renderer.clear();
         this.camera.position.set(0, 100, 300); this.camera.lookAt(0,0,0);
         this.renderer.render(this.scene, this.camera);
    }
  };

  private onWindowResize = () => {
    let w = window.innerWidth; let h = window.innerHeight;
    if (w < h) { [w, h] = [h, w]; }
    this.renderer.setSize(w, h);
    if (this.rtTexture) this.rtTexture.setSize(w, h);
    
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.fgCamera.aspect = w / h; this.fgCamera.updateProjectionMatrix();
    
    let aspect = w/h; let d = 1000;
    this.droneCamera.left = -d * aspect; this.droneCamera.right = d * aspect;
    this.droneCamera.top = d; this.droneCamera.bottom = -d;
    this.droneCamera.updateProjectionMatrix();
  };

  public dispose() {
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
  }
}

// --------------------------------------------------------
// 5. MAIN REACT APP
// --------------------------------------------------------
export default function App() {
  type AppState = 'AUTH'|'MAIN_MENU'|'GAME'|'FALLBACK';
  
  const [appState, setAppState] = useState<AppState>('AUTH');
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [saveData, setSaveData] = useState<SaveState>(DEFAULT_SAVE);
  
  const [hudData, setHudData] = useState({ health: 100, ammo: 30, phase: 'DRONE' });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GraphicEngine | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('sgrd_v11_save');
    if (saved) setSaveData(JSON.parse(saved));
  }, []);

  const saveGame = (data: SaveState) => {
      setSaveData(data); localStorage.setItem('sgrd_v11_save', JSON.stringify(data));
  };

  useEffect(() => {
    if ((appState === 'MAIN_MENU' || appState === 'GAME') && canvasRef.current && !engineRef.current) {
        engineRef.current = new GraphicEngine(canvasRef.current);
        return () => { engineRef.current?.dispose(); engineRef.current = null; };
    }
    if (engineRef.current) {
        engineRef.current.appMode = (appState === 'GAME') ? 'GAME' : 'HANGAR';
        engineRef.current.onHudUpdate = (data) => setHudData(prev => ({...prev, ...data}));
        engineRef.current.onScore = (pts, c) => saveGame({ ...saveData, score: saveData.score + pts, crystals: saveData.crystals + c });
        engineRef.current.onRetreat = () => setAppState('FALLBACK');
    }
  }, [appState]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault(); playHaptic('click');
    if (ACTIVATION_CODES.includes(code)) {
      try {
          if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
          if (window.screen?.orientation?.lock) await window.screen.orientation.lock('landscape');
      } catch (err) { }
      setAppState('MAIN_MENU'); initAudio();
    } else { setError(true); setTimeout(() => setError(false), 2000); }
  };

  const mapJoyLeft = (e: React.PointerEvent) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 2 - 1;
      const y = (e.clientY - rect.top) / rect.height * 2 - 1;
      engineRef.current?.setInput({ yaw: x, thrust: -y }); // Ground: strafe, fwd. Drone: target X, target Z
  };
  
  const mapJoyRight = (e: React.PointerEvent) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 2 - 1;
      const y = (e.clientY - rect.top) / rect.height * 2 - 1;
      engineRef.current?.setInput({ roll: -x, pitch: y }); // Ground: look. Drone: mostly ignored/orbit maybe
  };
  
  const resetJoyLeft = () => engineRef.current?.setInput({ yaw: 0, thrust: 0 });
  const resetJoyRight = () => engineRef.current?.setInput({ roll: 0, pitch: 0 });

  return (
    <div id="app-root" className="w-full h-full bg-[#0D0E10] text-white overflow-hidden select-none touch-none font-sans relative" dir="rtl">
      
      {appState === 'AUTH' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D0E10] z-50 p-6">
           <div className="w-full max-w-md border border-[#00FFFF]/30 bg-black/80 p-8 shadow-[0_0_50px_rgba(0,255,255,0.1)]">
              <h1 className="text-3xl font-black text-[#00FFFF] mb-2 tracking-widest text-center" dir="ltr">SYSTEM LOCK</h1>
              <p className="text-gray-400 text-sm mb-8 text-center" dir="ltr">ENTER 9-CODE AUTHORIZATION</p>
              <form onSubmit={handleAuth} className="flex flex-col gap-4">
                <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" dir="ltr"
                  className={`w-full bg-black border ${error ? 'border-[#FF0055] text-[#FF0055]' : 'border-[#00FFFF] text-[#00FFFF]'} p-4 text-center text-xl tracking-widest outline-none shadow-[inset_0_0_10px_rgba(0,255,255,0.2)]`} />
                <button type="submit" className="w-full bg-[#00FFFF]/20 border border-[#00FFFF] text-[#00FFFF] hover:bg-[#00FFFF] hover:text-black font-bold p-4 tracking-widest transition-colors mt-4">فك التشفير</button>
              </form>
           </div>
        </div>
      )}

      {(appState === 'MAIN_MENU' || appState === 'GAME') && ( <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" /> )}

      {appState === 'MAIN_MENU' && (
        <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent flex flex-col justify-center p-12 z-20">
           <h1 className="text-5xl font-black text-[#00FFFF] mb-2 drop-shadow-lg drop-shadow-[0_0_15px_#00FFFF]">المهندس: سهيل الهزبري</h1>
           <p className="text-xl text-gray-400 mb-12">القطاع: شرعب الأرضية - ترقية النواة المختلطة</p>
           <button onClick={() => { playHaptic('click'); setAppState('GAME'); engineRef.current?.setPhase('DRONE'); }} 
                className="bg-[#00FFFF]/20 border border-[#00FFFF] text-[#00FFFF] p-4 font-bold text-xl hover:bg-[#00FFFF] hover:text-black transition-colors w-80 text-center">
               دخول مركز العمليات
           </button>
        </div>
      )}

      {appState === 'FALLBACK' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 z-50">
           <h1 className="text-5xl font-black text-[#FF0055] mb-4">تراجع تكتيكي</h1>
           <p className="text-xl text-gray-300 mb-8 max-w-2xl text-center leading-relaxed">أضرار حرجة، تم العودة للقاعدة للتأمين.</p>
           <button onClick={() => { playHaptic('click'); setAppState('MAIN_MENU'); }} className="bg-[#00FFFF]/20 border border-[#00FFFF] text-[#00FFFF] px-12 py-5 hover:bg-[#00FFFF] hover:text-black font-black text-2xl transition-all shadow-[0_0_30px_rgba(0,255,255,0.3)]">تأكيد</button>
        </div>
      )}

      {appState === 'GAME' && (
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between">
           
           <div className="w-full flex justify-between p-6 pointer-events-none">
                <div className="flex flex-col gap-4 pointer-events-auto">
                    <button onClick={() => engineRef.current?.togglePhase()} className="bg-black/80 border border-[#00FFFF] text-[#00FFFF] px-6 py-3 hover:bg-[#00FFFF] hover:text-black transition-colors w-[300px] text-lg font-bold shadow-[0_0_10px_rgba(0,255,255,0.2)]">
                        نظام التبديل بين الطائرة والجندي
                    </button>
                    {hudData.phase === 'GROUND_FPS' && (
                        <button onClick={() => engineRef.current?.requestAirSupport()} className="bg-black/80 border border-[#00FF00] text-[#00FF00] px-6 py-3 hover:bg-[#00FF00] hover:text-black transition-colors w-[300px] text-lg font-bold shadow-[0_0_15px_rgba(0,255,0,0.3)]">
                            استدعاء الإسناد الجوي
                        </button>
                    )}
                    
                    {hudData.phase === 'GROUND_FPS' && (
                        <div className="flex flex-col gap-2 mt-4 pointer-events-none">
                             <div className="bg-black/80 border border-green-500 px-4 py-3 flex items-center gap-4 w-[300px] shadow-lg">
                                 <span className="text-sm font-bold text-green-500 min-w-[120px]">مؤشر الصحة الحيوية:</span>
                                 <div className="flex-1 h-3 bg-gray-800">
                                     <div className="h-full bg-green-500 transition-all" style={{width: `${hudData.health}%`}} />
                                 </div>
                                 <span className="text-white font-mono">{hudData.health}%</span>
                             </div>
                             <div className="bg-black/80 border border-yellow-500 px-4 py-3 flex items-center gap-4 w-[300px] shadow-lg">
                                 <span className="text-sm font-bold text-yellow-500 min-w-[120px]">مخزن الذخيرة الحالي:</span>
                                 <div className="flex-1 h-3 flex gap-1 justify-end overflow-hidden">
                                     {Array.from({length: Math.min(hudData.ammo, 30)}).map((_, i) => (<div key={i} className="w-1 h-full bg-yellow-400" />))}
                                 </div>
                                 <span className="text-white font-mono">{hudData.ammo}</span>
                             </div>
                        </div>
                    )}
                </div>

                {hudData.phase === 'GROUND_FPS' && (
                    <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-2 border-[#00FFFF]/50 bg-black/80 relative shadow-[0_0_20px_rgba(0,255,255,0.2)] overflow-hidden pointer-events-auto">
                        <div className="absolute top-2 left-0 right-0 text-center text-[#00FFFF] text-xs font-bold pt-1">رادار الخريطة المصغر</div>
                        <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-[#00FFFF] rounded-full shadow-[0_0_10px_#00FFFF] -translate-x-1/2 -translate-y-1/2" />
                        <div className="absolute top-1/2 left-1/2 w-full h-full border border-[#00FFFF]/30 rounded-full animate-ping -translate-x-1/2 -translate-y-1/2" />
                    </div>
                )}
           </div>

           {/* Center Canvas Reticles overlay */}
           {hudData.phase === 'DRONE' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vh] border-2 border-white/30" style={{boxShadow: 'inset 0 0 50px rgba(255,255,255,0.1)'}}>
                    <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-white/30" />
                    <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-white/30" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100px] h-[80px] border-2 border-white/80" />
                    <div className="absolute top-4 left-4 text-white text-xl font-mono tracking-widest font-bold" dir="ltr">FLIR ACTIVE</div>
                    <div className="absolute top-10 left-4 text-white text-md font-mono" dir="ltr">HIGH-VALUE TGT: ON</div>
                    <div className="absolute top-4 right-4 text-white text-xl font-mono tracking-widest font-bold" dir="ltr">ALT 30K.2</div>
                </div>
           )}

           {hudData.phase === 'GROUND_FPS' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
                        <div className="w-1 h-1 bg-[#FF0000] rounded-full shadow-[0_0_8px_#ff0000]" />
                    </div>
                </div>
           )}

           <div className="w-full flex justify-between items-end p-6 pointer-events-none">
              <div 
                className="w-32 h-32 md:w-48 md:h-48 rounded-full border-2 border-white/20 bg-white/5 pointer-events-auto flex items-center justify-center backdrop-blur-sm relative"
                onPointerDown={mapJoyLeft} onPointerMove={(e) => e.buttons > 0 && mapJoyLeft(e)} onPointerUp={resetJoyLeft} onPointerLeave={resetJoyLeft}>
                 <svg viewBox="0 0 100 100" fill="none" stroke="#00FFFF" strokeWidth="2" className="absolute inset-0 w-full h-full opacity-20"><circle cx="50" cy="50" r="40" strokeDasharray="4 4" /></svg>
                 <div className="w-12 h-12 rounded-full bg-[#00FFFF]/50 shadow-[0_0_15px_#00FFFF] pointer-events-none"></div>
              </div>

              <button className="pointer-events-auto self-end mb-4 p-6 md:p-8 rounded-full bg-[#FF0055]/30 border-2 border-[#FF0055] text-white shadow-[0_0_30px_rgba(255,0,85,0.6)] active:bg-[#FF0055] transition-colors"
                onPointerDown={() => engineRef.current?.fire()}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v4 M12 18v4 M2 12h4 M18 12h4" />
                  </svg>
              </button>

              <div 
                className="w-32 h-32 md:w-48 md:h-48 rounded-full border-2 border-white/20 bg-white/5 pointer-events-auto flex items-center justify-center backdrop-blur-sm relative"
                onPointerDown={mapJoyRight} onPointerMove={(e) => e.buttons > 0 && mapJoyRight(e)} onPointerUp={resetJoyRight} onPointerLeave={resetJoyRight}>
                 <svg viewBox="0 0 100 100" fill="none" stroke="#00FF66" strokeWidth="2" className="absolute inset-0 w-full h-full opacity-20"><circle cx="50" cy="50" r="40" strokeDasharray="4 4" /></svg>
                 <div className="w-12 h-12 rounded-full bg-[#00FF66]/50 shadow-[0_0_15px_#00FF66] pointer-events-none"></div>
              </div>
           </div>

        </div>
      )}
      
      <style>{`
        html, body, #root { width: 100vw !important; height: 100vh !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background-color: #0D0E10; }
        #app-root { width: 100vw; height: 100vh; position: absolute; left: 0; top: 0; }
        @media screen and (orientation: portrait) {
            #app-root { width: 100vh !important; height: 100vw !important; position: absolute; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) rotate(90deg) !important; }
        }
      `}</style>
    </div>
  );
}
