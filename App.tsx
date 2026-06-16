import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';

// --- CONFIG & CONSTANTS ---
const ACTIVATION_CODES = [
  "SGRD-99X-HAZBARI", "YAQEEN-INTEL-88", "CYBER-B2-STEALTH", 
  "MILKYWAY-X-PASS", "ALPHA-60FPS-GL", "TACTICAL-DRIFT-Z", 
  "MERCURY-CORE-01", "SHADOW-ENGINE-X", "SUPREME-MIND-26"
];

function terrainNoise(x: number, z: number) {
    let y = 0;
    let amp = 300;
    let freq = 0.001;
    for (let j = 0; j < 4; j++) {
        y += Math.sin(x * freq) * Math.cos(z * freq) * amp;
        y += Math.abs(Math.sin(x * freq * 2 + z * freq * 2)) * amp * 0.2;
        amp *= 0.4;
        freq *= 2.5;
    }
    return y;
}

// --- 3D ENGINE ---
class GraphicEngine {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  
  // Foreground Scene (for Ship to prevent clipping)
  private fgScene!: THREE.Scene;
  private fgCamera!: THREE.PerspectiveCamera;

  private asteroids!: THREE.InstancedMesh;
  private starSystem!: THREE.Points;
  private shipGroup!: THREE.Group;
  
  private clock = new THREE.Clock();
  private bullets: THREE.Mesh[] = [];
  
  private input = { thrust: 0, yaw: 0, pitch: 0, roll: 0, fire: false };
  private velocity = new THREE.Vector3();
  private speed = 0;
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.init();
  }

  private init() {
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w < h) {
      [w, h] = [h, w];
    }

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020304);
    // Dark brown/reddish sci-fi planetary fog fitting the theme
    this.scene.fog = new THREE.FogExp2(0x1a1512, 0.0003);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 25000);
    this.camera.position.set(0, 50, 0);

    this.fgScene = new THREE.Scene();
    this.fgCamera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    this.fgCamera.position.set(0, 5, 15);
    this.fgCamera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    const dirLight = new THREE.DirectionalLight(0x00ffff, 1.5);
    dirLight.position.set(50, 100, 50);
    this.scene.add(ambientLight.clone(), dirLight.clone());
    this.fgScene.add(ambientLight, dirLight);

    this.createSpaceDustSystem();
    this.createAsteroids();
    this.createTerrain();
    this.createShip();
    
    window.addEventListener('resize', this.onWindowResize);
    this.renderer.setAnimationLoop(this.animate);
  }

  private createSpaceDustSystem() {
    const starCount = 5000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const phases = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = Math.exp(Math.random() * 5) * 10;
      const z = (Math.random() - 0.5) * r * 0.5;

      positions[i * 3] = r * Math.cos(theta);
      positions[i * 3 + 1] = z;
      positions[i * 3 + 2] = r * Math.sin(theta);
      phases[i] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `
        attribute float phase;
        varying float vAlpha;
        uniform float time;
        void main() {
          vAlpha = 0.5 + 0.5 * sin(time * 2.0 + phase);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (100.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          vec2 xy = gl_PointCoord.xy - vec2(0.5);
          float ll = length(xy);
          if(ll > 0.5) discard;
          gl_FragColor = vec4(0.8, 0.9, 1.0, vAlpha * (1.0 - ll*2.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.starSystem = new THREE.Points(geometry, material);
    this.scene.add(this.starSystem);
  }

  private createAsteroids() {
    const count = 1000;
    const geometry = new THREE.DodecahedronGeometry(5, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });

    this.asteroids = new THREE.InstancedMesh(geometry, material, count);
    
    const dummy = new THREE.Object3D();
    for(let i = 0; i < count; i++) {
      dummy.position.set(
        (Math.random() - 0.5) * 1000,
        Math.random() * 200 + 50, // Keep asteroids above terrain
        -Math.random() * 4000 - 100
      );
      dummy.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      dummy.scale.setScalar(Math.random() * 2 + 0.5);
      dummy.updateMatrix();
      this.asteroids.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(this.asteroids);
  }

  private createTerrain() {
    const size = 20000;
    const segments = 200;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    const colors = [];
    const color = new THREE.Color();
    
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        
        let y = terrainNoise(x, z);
        
        if (y < -100) y = -100 + (y + 100) * 0.2;
        
        y -= 400; 
        
        pos.setY(i, y);
        
        if (y > -150) {
            color.setHex(0x3a2f2a);
        } else if (y < -450) {
            color.setHex(0x1a1512);
        } else {
            color.setHex(0x2a1f1a);
        }
        colors.push(color.r, color.g, color.b);
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({ 
        vertexColors: true,
        roughness: 0.9, 
        metalness: 0.1,
    });
    
    const terrain = new THREE.Mesh(geometry, material);
    this.scene.add(terrain);

    const blockCount = 1000;
    const bGeo = new THREE.BoxGeometry(20, 20, 20);
    bGeo.translate(0, 10, 0);
    const bMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1.0 });
    
    const instanced = new THREE.InstancedMesh(bGeo, bMat, blockCount);
    const dummy = new THREE.Object3D();
    
    for (let i = 0; i < blockCount; i++) {
        const x = (Math.random() - 0.5) * 8000;
        const z = (Math.random() - 0.5) * 8000 - 4000;
        let y = terrainNoise(x, z);
        if (y < -100) y = -100 + (y + 100) * 0.2;
        y -= 400;
        
        if (y < -400) {
            dummy.position.set(x, y, z);
            dummy.scale.set(1 + Math.random(), 1 + Math.random()*3, 1 + Math.random());
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.updateMatrix();
            instanced.setMatrixAt(i, dummy.matrix);
        } else {
            dummy.position.set(0, -9999, 0);
            dummy.updateMatrix();
            instanced.setMatrixAt(i, dummy.matrix);
        }
    }
    this.scene.add(instanced);
  }

  private createShip() {
    this.shipGroup = new THREE.Group();
    
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 5);
    wingShape.lineTo(4, -2);
    wingShape.lineTo(0, 0);
    wingShape.lineTo(-4, -2);
    wingShape.lineTo(0, 5);
    
    const extrudeSettings = { depth: 0.5, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 };
    const geometry = new THREE.ExtrudeGeometry(wingShape, extrudeSettings);
    geometry.rotateX(-Math.PI / 2);
    geometry.center();
    
    const material = new THREE.MeshStandardMaterial({ color: 0x1A1B1C, roughness: 0.7 });
    const wing = new THREE.Mesh(geometry, material);
    
    const trimGeo = new THREE.BoxGeometry(7, 0.1, 0.1);
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x00FFFF });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.set(0, 0.25, 1);
    wing.add(trim);

    this.shipGroup.add(wing);
    this.fgScene.add(this.shipGroup);
  }

  public setInput(input: any) {
    this.input = { ...this.input, ...input };
  }
  
  public onScore: (s: number) => void = () => {};

  public fireLaser() {
    if(!this.scene) return;
    const material = new THREE.MeshBasicMaterial({ color: 0x00FF66 });
    const geometry = new THREE.CylinderGeometry(0.1, 0.1, 4);
    geometry.rotateX(Math.PI / 2);
    
    [-2, 2].forEach(offsetX => {
       const laser = new THREE.Mesh(geometry, material);
       laser.position.copy(this.camera.position);
       laser.position.x += offsetX;
       laser.position.y -= 1;
       
       const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
       laser.userData = { velocity: dir.multiplyScalar(500) };
       
       this.scene.add(laser);
       this.bullets.push(laser);
    });
  }

  private animate = () => {
    const dt = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    if(this.starSystem) {
      (this.starSystem.material as THREE.ShaderMaterial).uniforms.time.value = time;
    }

    const targetSpeed = this.input.thrust * 100;
    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, dt * 2);
    this.velocity.z = -this.speed;
    
    const turnSpeed = 2.0;
    this.camera.rotateY(-this.input.yaw * turnSpeed * dt);
    this.camera.rotateX(-this.input.pitch * turnSpeed * dt);
    this.camera.rotateZ(this.input.roll * turnSpeed * dt);
    this.camera.translateZ(this.velocity.z * dt);
    
    this.shipGroup.rotation.z = THREE.MathUtils.lerp(this.shipGroup.rotation.z, -this.input.yaw * Math.PI / 4 + this.input.roll * Math.PI / 4, dt * 5);
    this.shipGroup.rotation.x = THREE.MathUtils.lerp(this.shipGroup.rotation.x, this.input.pitch * Math.PI / 8, dt * 5);
    
    const dummyMat = new THREE.Matrix4();
    const dummyPos = new THREE.Vector3();
    const count = this.asteroids ? this.asteroids.count : 0;

    for(let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.position.addScaledVector(b.userData.velocity, dt);
        
        let hit = false;
        
        if (this.asteroids) {
            for (let j = 0; j < count; j++) {
                this.asteroids.getMatrixAt(j, dummyMat);
                dummyPos.setFromMatrixPosition(dummyMat);
                // Rough bounding sphere check
                if (dummyPos.distanceTo(b.position) < 15) {
                    hit = true;
                    // Move asteroid away (destroy)
                    dummyMat.setPosition(0, 10000, 0);
                    this.asteroids.setMatrixAt(j, dummyMat);
                    this.asteroids.instanceMatrix.needsUpdate = true;
                    this.onScore(100);
                    break;
                }
            }
        }

        if (hit || b.position.distanceTo(this.camera.position) > 2000) {
            this.scene.remove(b);
            this.bullets.splice(i, 1);
        }
    }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.fgScene, this.fgCamera);
  };

  private onWindowResize = () => {
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w < h) {
      [w, h] = [h, w];
    }
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fgCamera.aspect = w / h;
    this.fgCamera.updateProjectionMatrix();
  };

  public dispose() {
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
  }
}

// --- REACT APP ---
export default function App() {
  const [appState, setAppState] = useState<'AUTH'|'SPLASH1'|'SPLASH2'|'GAME'>('AUTH');
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [score, setScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GraphicEngine | null>(null);
  
  const [heading, setHeading] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem('sgrd_activated');
    if (saved === 'true') {
      startSplash();
    }
    const savedScore = parseInt(localStorage.getItem('sgrd_score') || '0', 10);
    setScore(savedScore);
  }, []);

  useEffect(() => {
    if (appState === 'GAME' && canvasRef.current && !engineRef.current) {
      engineRef.current = new GraphicEngine(canvasRef.current);
      engineRef.current.onScore = (pts: number) => {
          setScore(s => {
              const newScore = s + pts;
              localStorage.setItem('sgrd_score', newScore.toString());
              return newScore;
          });
      };
      const hudLoop = setInterval(() => {
         setHeading(h => (h + 1) % 360);
      }, 100);
      return () => {
        clearInterval(hudLoop);
        engineRef.current?.dispose();
        engineRef.current = null;
      };
    }
  }, [appState]);

  const startSplash = async () => {
    try {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        }
        if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
            await window.screen.orientation.lock('landscape');
        }
    } catch (e) {
        console.warn('Fullscreen/Orientation lock failed', e);
    }
    
    setAppState('SPLASH1');
    setTimeout(() => {
      setAppState('SPLASH2');
      setTimeout(() => {
        setAppState('GAME');
      }, 2500);
    }, 2500);
  };

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (ACTIVATION_CODES.includes(code)) {
      localStorage.setItem('sgrd_activated', 'true');
      startSplash();
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  const handleJoyLeft = (e: React.PointerEvent) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 2 - 1;
      const y = (e.clientY - rect.top) / rect.height * 2 - 1;
      engineRef.current?.setInput({ yaw: x, thrust: -y });
  };
  
  const handleJoyRight = (e: React.PointerEvent) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 2 - 1;
      const y = (e.clientY - rect.top) / rect.height * 2 - 1;
      engineRef.current?.setInput({ roll: -x, pitch: y });
  };
  
  const resetJoyLeft = () => engineRef.current?.setInput({ yaw: 0, thrust: 0 });
  const resetJoyRight = () => engineRef.current?.setInput({ roll: 0, pitch: 0 });

  return (
    <div id="app-root" className="w-full h-full bg-[#0D0E10] text-white overflow-hidden select-none touch-none font-mono relative">
      
      {appState === 'AUTH' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D0E10] z-50 p-6">
           <div className="w-full max-w-md border border-[#00FFFF]/30 bg-black/80 p-8 shadow-[0_0_50px_rgba(0,255,255,0.1)]">
              <h1 className="text-3xl font-black text-[#00FFFF] mb-2 tracking-widest text-center">SYSTEM LOCK</h1>
              <p className="text-gray-400 text-sm mb-8 text-center">ENTER 9-CODE AUTHORIZATION</p>
              
              <form onSubmit={handleAuth} className="flex flex-col gap-4">
                <input 
                  type="text" 
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX"
                  className={`w-full bg-black border ${error ? 'border-red-500 text-red-500' : 'border-[#00FFFF] text-[#00FFFF]'} p-4 text-center text-xl tracking-widest outline-none shadow-[inset_0_0_10px_rgba(0,255,255,0.2)]`}
                />
                <button type="submit" className="w-full bg-[#00FFFF]/20 border border-[#00FFFF] text-[#00FFFF] hover:bg-[#00FFFF] hover:text-black font-bold p-4 tracking-widest transition-colors mt-4">
                  DECRYPT
                </button>
              </form>
           </div>
        </div>
      )}

      {appState === 'SPLASH1' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50 animate-pulse">
           <h1 className="text-4xl md:text-6xl font-black tracking-[0.5em] text-white drop-shadow-[0_0_15px_#FFFFFF] text-center">
             TANKEEL-X<br/>
             <span className="text-xl md:text-2xl text-gray-400 font-light tracking-[0.3em] mt-4 block">Cinematic Space Odyssey</span>
           </h1>
        </div>
      )}

      {appState === 'SPLASH2' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
           <h2 className="text-2xl md:text-4xl font-bold tracking-[0.2em] text-[#00FF66] drop-shadow-[0_0_20px_#00FF66]">
             ENGINEER: SUHAIL AL-HAZBARI
           </h2>
        </div>
      )}

      {appState === 'GAME' && (
        <div className="relative w-full h-full bg-black">
           <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
           
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30vh] h-[30vh] md:w-[40vh] md:h-[40vh] rounded-full border border-[#00FFFF]/30 pointer-events-none">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#00FFFF]/20 px-2 text-[#00FFFF] text-xs">N</div>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 bg-[#00FFFF]/20 px-2 text-[#00FFFF] text-xs">S</div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 bg-[#00FFFF]/20 py-2 text-[#00FFFF] text-xs" style={{writingMode: 'vertical-rl'}}>W</div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 bg-[#00FFFF]/20 py-2 text-[#00FFFF] text-xs" style={{writingMode: 'vertical-rl'}}>E</div>
              <div className="absolute inset-0 border-[0.5px] border-[#00FFFF]/10 rounded-full scale-75 border-dashed animate-spin-slow"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border border-[#FF0055]/50 flex items-center justify-center">
                <div className="w-1 h-1 bg-[#FF0055]"></div>
              </div>
           </div>

           <div className="absolute bottom-8 left-8 right-8 flex justify-between items-end pointer-events-none px-[24px] pb-[24px]">
              <div 
                className="w-32 h-32 md:w-48 md:h-48 rounded-full border-2 border-white/20 bg-white/5 pointer-events-auto flex items-center justify-center backdrop-blur-sm relative"
                onPointerDown={handleJoyLeft}
                onPointerMove={(e) => e.buttons > 0 && handleJoyLeft(e)}
                onPointerUp={resetJoyLeft}
                onPointerLeave={resetJoyLeft}
              >
                 <svg viewBox="0 0 100 100" fill="none" stroke="#00FFFF" strokeWidth="2" className="absolute inset-0 w-full h-full opacity-20 pointer-events-none">
                    <circle cx="50" cy="50" r="40" strokeDasharray="4 4" />
                    <path d="M50 5 L55 15 L45 15 Z" fill="#00FFFF" />
                    <path d="M50 95 L55 85 L45 85 Z" fill="#00FFFF" />
                    <path d="M5 50 L15 45 L15 55 Z" fill="#00FFFF" />
                    <path d="M95 50 L85 45 L85 55 Z" fill="#00FFFF" />
                 </svg>
                 <div className="w-12 h-12 rounded-full bg-[#00FFFF]/50 shadow-[0_0_15px_#00FFFF]"></div>
              </div>

              <button 
                className="pointer-events-auto self-end mb-4 p-6 md:p-8 rounded-full bg-[#00FF66]/20 border-2 border-[#00FF66] text-[#00FF66] shadow-[0_0_20px_rgba(0,255,102,0.4)] active:bg-[#00FF66] active:text-black transition-colors flex items-center justify-center"
                onPointerDown={() => engineRef.current?.fireLaser()}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" fill="currentColor"/>
                  <path d="M12 2v4 M12 18v4 M2 12h4 M18 12h4" />
                </svg>
              </button>

              <div 
                className="w-32 h-32 md:w-48 md:h-48 rounded-full border-2 border-white/20 bg-white/5 pointer-events-auto flex items-center justify-center backdrop-blur-sm relative"
                onPointerDown={handleJoyRight}
                onPointerMove={(e) => e.buttons > 0 && handleJoyRight(e)}
                onPointerUp={resetJoyRight}
                onPointerLeave={resetJoyRight}
              >
                 <svg viewBox="0 0 100 100" fill="none" stroke="#FF0055" strokeWidth="2" className="absolute inset-0 w-full h-full opacity-20 pointer-events-none">
                    <circle cx="50" cy="50" r="40" strokeDasharray="4 4" />
                    <path d="M50 5 L55 15 L45 15 Z" fill="#FF0055" />
                    <path d="M50 95 L55 85 L45 85 Z" fill="#FF0055" />
                    <path d="M5 50 L15 45 L15 55 Z" fill="#FF0055" />
                    <path d="M95 50 L85 45 L85 55 Z" fill="#FF0055" />
                 </svg>
                 <div className="w-12 h-12 rounded-full bg-[#FF0055]/50 shadow-[0_0_15px_#FF0055]"></div>
              </div>
           </div>

           <div className="absolute top-6 left-6 text-[#00FFFF] font-mono text-sm tracking-widest opacity-80 pointer-events-none">
              <div>SYS.OP: OFFLINE KERNEL</div>
              <div>WEBGL2 INSTANCING: ACTIVE</div>
              <div>6-DOF: ENABLED</div>
              <div className="mt-4 text-emerald-400 font-black text-xl">CREDITS: {score}</div>
           </div>
        </div>
      )}
      
      <style>{`
        html, body, #root {
          width: 100vw !important;
          height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
          background-color: #0D0E10;
        }

        #app-root {
          width: 100vw;
          height: 100vh;
          position: absolute;
          left: 0;
          top: 0;
        }

        .animate-spin-slow {
          animation: spin 20s linear infinite;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media screen and (orientation: portrait) {
            #app-root {
                width: 100vh !important;
                height: 100vw !important;
                position: absolute;
                left: 50% !important;
                top: 50% !important;
                transform: translate(-50%, -50%) rotate(90deg) !important;
            }
        }
      `}</style>
    </div>
  );
}
