import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';

// --------------------------------------------------------
// 1. CONSTANTS & SYSTEM DICTIONARY
// --------------------------------------------------------
const ACTIVATION_CODES = [
  "SGRD-99X-HAZBARI", "YAQEEN-INTEL-88", "CYBER-B2-STEALTH", 
  "MILKYWAY-X-PASS", "ALPHA-60FPS-GL", "TACTICAL-DRIFT-Z", 
  "MERCURY-CORE-01", "SHADOW-ENGINE-X", "SUPREME-MIND-26"
];

const OFFLINE_VOUCHERS: Record<string, {type: "skin"|"ammo", name: string}> = {
  "SHARAB-GOLD-V10": { type: "skin", name: "المقاتلة الذهبية المستدامة" },
  "AMMO-INF-99X": { type: "ammo", name: "ذخيرة بلازما لانهائية" }
};

interface SaveState {
    pilotName: string;
    crystals: number;
    score: number;
    upgrades: { plasma: number; missiles: number; engine: number; };
    unlockedSkins: string[];
    infiniteAmmo: boolean;
    lastLuckyWheelTimestamp: number;
}

const DEFAULT_SAVE: SaveState = {
    pilotName: "طيار مجهول",
    crystals: 0,
    score: 0,
    upgrades: { plasma: 1, missiles: 1, engine: 1 },
    unlockedSkins: [],
    infiniteAmmo: false,
    lastLuckyWheelTimestamp: 0
};

// --------------------------------------------------------
// 2. AUDIO SYNTHESIS ENGINE (HAPTICS)
// --------------------------------------------------------
let audioCtx: AudioContext | null = null;
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playHaptic(type: 'laser' | 'explosion' | 'click' | 'upgrade') {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
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
    } else if (type === 'upgrade') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.2);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    }
}

// --------------------------------------------------------
// 3. MATH & PROCEDURAL TERRAIN (SHARAB AL-SALAM)
// --------------------------------------------------------
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

// --------------------------------------------------------
// 4. GRAPHIC ENGINE
// --------------------------------------------------------
class GraphicEngine {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  
  private fgScene!: THREE.Scene;
  private fgCamera!: THREE.PerspectiveCamera;

  private asteroids!: THREE.InstancedMesh;
  private starSystem!: THREE.Points;
  private shipGroup!: THREE.Group;
  private shipMaterial!: THREE.MeshStandardMaterial;
  
  private terrain!: THREE.Mesh;
  private buildings!: THREE.InstancedMesh;
  private enemyTowers: { mesh: THREE.Mesh, hp: number, active: boolean }[] = [];

  private clock = new THREE.Clock();
  private bullets: THREE.Mesh[] = [];
  
  private input = { thrust: 0, yaw: 0, pitch: 0, roll: 0, fire: false };
  private velocity = new THREE.Vector3();
  private speed = 0;
  
  public appMode: 'HANGAR' | 'GAME' = 'HANGAR';
  public combatPhase: 'SPACE' | 'DESCENDING' | 'DRONE' = 'SPACE';
  public shipHealth = 100;
  public infiniteAmmo = false;
  
  // Drone Mode Internals
  private rtTexture!: THREE.WebGLRenderTarget;
  private postScene!: THREE.Scene;
  private postCamera!: THREE.OrthographicCamera;
  private postMaterial!: THREE.ShaderMaterial;
  private flashIntensity = 0;
  private cameraShake = 0;
  private droneAngles = { theta: 0, phi: Math.PI/4, radius: 800 }; 
  private droneCenter = new THREE.Vector3(0, 0, 0); 
  
  public onScore: (score: number, crystals: number) => void = () => {};
  public onRetreat: () => void = () => {};
  public onPhaseChange: (phase: string) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.init();
  }

  private init() {
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w < h) { [w, h] = [h, w]; }

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020304);
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
          vec3 final = vec3(lum);
          // HVT enemies emit white
          if (c.r > 0.8 && c.g < 0.2 && c.b < 0.2) final = vec3(1.0, 1.0, 1.0);
          else if (c.g > 0.8 && c.b > 0.8 && c.r < 0.2) final = vec3(1.0, 1.0, 1.0);
          
          final += fract(sin(dot(vUv * time, vec2(12.9898, 78.233))) * 43758.5453) * 0.05;
          final -= sin(vUv.y * 800.0) * 0.02;
          final += flash;
          final = smoothstep(0.1, 0.9, final);
          gl_FragColor = vec4(final, 1.0);
        }
      `
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

    this.createSpaceDustSystem();
    this.createAsteroids();
    this.createTerrain();
    this.createShip();
    this.createEnemies();
    
    window.addEventListener('resize', this.onWindowResize);
    this.renderer.setAnimationLoop(this.animate);
  }

  public applySkin(isGolden: boolean) {
      if (this.shipMaterial) {
          this.shipMaterial.color.setHex(isGolden ? 0xFFD700 : 0x1A1B1C);
          this.shipMaterial.roughness = isGolden ? 0.3 : 0.7;
          this.shipMaterial.metalness = isGolden ? 0.8 : 0.2;
      }
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
        Math.random() * 800 + 300, 
        -Math.random() * 8000 - 100
      );
      dummy.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      dummy.scale.setScalar(Math.random() * 2 + 0.5);
      dummy.updateMatrix();
      this.asteroids.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(this.asteroids);
  }

  private createTerrain() {
    const size = 30000;
    const segments = 150;
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
    
    this.terrain = new THREE.Mesh(geometry, material);
    this.scene.add(this.terrain);

    const blockCount = 1000;
    const bGeo = new THREE.BoxGeometry(20, 20, 20);
    bGeo.translate(0, 10, 0);
    const bMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1.0 });
    
    this.buildings = new THREE.InstancedMesh(bGeo, bMat, blockCount);
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
            this.buildings.setMatrixAt(i, dummy.matrix);
        } else {
            dummy.position.set(0, -9999, 0);
            dummy.updateMatrix();
            this.buildings.setMatrixAt(i, dummy.matrix);
        }
    }
    this.scene.add(this.buildings);
  }

  private createEnemies() {
      const g = new THREE.CylinderGeometry(5, 10, 40, 8);
      g.translate(0, 20, 0);
      const m = new THREE.MeshStandardMaterial({ color: 0xFF0033, roughness: 0.5, metalness: 0.8 });
      for(let i=0; i<150; i++) {
          const mesh = new THREE.Mesh(g, m);
          const x = (Math.random() - 0.5) * 8000;
          const z = (Math.random() - 0.5) * 8000;
          let y = terrainNoise(x, z) - 400;
          if (y > -200) y = -200; // Place firmly
          mesh.position.set(x, y, z);
          this.scene.add(mesh);
          this.enemyTowers.push({ mesh, hp: 100, active: true });
      }
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
    
    this.shipMaterial = new THREE.MeshStandardMaterial({ color: 0x1A1B1C, roughness: 0.7 });
    const wing = new THREE.Mesh(geometry, this.shipMaterial);
    
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

  public triggerDescend() {
      this.combatPhase = 'DESCENDING';
      this.onPhaseChange('DESCENDING');
  }
  
  public fireLaser() {
    if(!this.scene) return;
    
    if (this.combatPhase === 'DRONE') {
        playHaptic('laser'); 
        this.cameraShake = 0.3;
        const mGeo = new THREE.CylinderGeometry(1, 1, 10);
        mGeo.rotateX(Math.PI/2);
        const mMat = new THREE.MeshBasicMaterial({color: 0x00ffff}); // Bright white in FLIR
        const missile = new THREE.Mesh(mGeo, mMat);
        
        missile.position.copy(this.camera.position);
        missile.position.y -= 10;
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0,0), this.camera);
        const intersects = raycaster.intersectObjects([this.terrain, this.buildings]);
        let targetPoint = new THREE.Vector3().copy(this.camera.position).add(raycaster.ray.direction.multiplyScalar(2000));
        if (intersects.length > 0) {
           targetPoint = intersects[0].point;
        }

        missile.userData = { target: targetPoint, speed: 1200, type: 'missile' };
        this.scene.add(missile);
        this.bullets.push(missile);
    } else {
        playHaptic('laser');
        const material = new THREE.MeshBasicMaterial({ color: 0x00FF66 });
        const geometry = new THREE.CylinderGeometry(0.5, 0.5, 6);
        geometry.rotateX(Math.PI / 2);
        
        [-5, 5].forEach(offsetX => {
           const laser = new THREE.Mesh(geometry, material);
           laser.position.copy(this.camera.position);
           laser.position.x += offsetX;
           laser.position.y -= 2;
           
           const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
           laser.userData = { velocity: dir.multiplyScalar(2000), type: 'laser' };
           
           this.scene.add(laser);
           this.bullets.push(laser);
        });
    }
  }

  private addSmoke(pos: THREE.Vector3) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(5), new THREE.MeshBasicMaterial({color: 0x888888, transparent: true, opacity: 0.8}));
      s.position.copy(pos);
      s.scale.setScalar(Math.random() * 0.5 + 0.5);
      s.userData = { life: 1.0, type: 'smoke' };
      this.scene.add(s);
      this.bullets.push(s); 
  }

  private addDebris(pos: THREE.Vector3) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({color: 0xffffff}));
      s.position.copy(pos);
      s.userData = {
         velocity: new THREE.Vector3((Math.random()-0.5)*200, Math.random()*200, (Math.random()-0.5)*200),
         life: 1.5,
         type: 'debris'
      };
      this.scene.add(s);
      this.bullets.push(s);
  }

  private animate = () => {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsedTime();

    if (this.starSystem) {
      (this.starSystem.material as THREE.ShaderMaterial).uniforms.time.value = time;
    }

    if (this.appMode === 'HANGAR') {
        this.shipGroup.visible = true;
        this.camera.position.set(0, 10, 30);
        this.camera.lookAt(0, 0, 0);
        this.shipGroup.position.set(0, 0, 0);
        this.shipGroup.rotation.z = 0;
        this.shipGroup.rotation.x = 0;
        this.shipGroup.rotation.y += 0.5 * dt;

        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.clearDepth();
        this.renderer.render(this.fgScene, this.fgCamera);

    } else {
        if (this.combatPhase === 'SPACE') {
            this.shipGroup.visible = true;
            const targetSpeed = this.input.thrust * 300;
            this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, dt * 2);
            this.velocity.z = -this.speed;
            
            const turnSpeed = 2.0;
            this.camera.rotateY(-this.input.yaw * turnSpeed * dt);
            this.camera.rotateX(-this.input.pitch * turnSpeed * dt);
            this.camera.rotateZ(this.input.roll * turnSpeed * dt);
            this.camera.translateZ(this.velocity.z * dt);
            
            const tx = this.camera.position.x;
            const tz = this.camera.position.z;
            let groundHeight = terrainNoise(tx, tz);
            if (groundHeight < -100) groundHeight = -100 + (groundHeight + 100) * 0.2;
            groundHeight -= 400;

            const targetAlt = Math.max(groundHeight + 50, 50);
            this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetAlt, dt * 0.5);
            
            this.shipGroup.rotation.z = THREE.MathUtils.lerp(this.shipGroup.rotation.z, -this.input.yaw * Math.PI / 4 + this.input.roll * Math.PI / 4, dt * 5);
            this.shipGroup.rotation.x = THREE.MathUtils.lerp(this.shipGroup.rotation.x, this.input.pitch * Math.PI / 8, dt * 5);

        } else if (this.combatPhase === 'DESCENDING') {
            this.shipGroup.visible = false;
            const targetPos = new THREE.Vector3(this.camera.position.x, 800, this.camera.position.z);
            this.camera.position.lerp(targetPos, dt * 2.5);
            this.camera.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2, 0, 0)), dt * 2.5);

            if (this.camera.position.y > 780) {
               this.combatPhase = 'DRONE';
               this.onPhaseChange('DRONE');
               this.droneCenter.set(this.camera.position.x, 0, this.camera.position.z - 200);
            }

        } else if (this.combatPhase === 'DRONE') {
            this.shipGroup.visible = false;
            this.droneCenter.x += this.input.yaw * 1500 * dt; 
            this.droneCenter.z -= this.input.thrust * 1500 * dt; 
            
            this.droneAngles.phi += this.input.pitch * dt; 
            this.droneAngles.phi = THREE.MathUtils.clamp(this.droneAngles.phi, Math.PI/8, Math.PI/2 - 0.1);
            
            this.droneAngles.radius -= this.input.roll * 2000 * dt; 
            this.droneAngles.radius = THREE.MathUtils.clamp(this.droneAngles.radius, 400, 1500);

            this.camera.position.x = this.droneCenter.x;
            this.camera.position.z = this.droneCenter.z + this.droneAngles.radius * Math.cos(this.droneAngles.phi);
            this.camera.position.y = this.droneAngles.radius * Math.sin(this.droneAngles.phi);
            this.camera.lookAt(this.droneCenter);

            if (this.cameraShake > 0) {
               this.camera.position.x += (Math.random()-0.5)*this.cameraShake*50;
               this.camera.position.y += (Math.random()-0.5)*this.cameraShake*50;
               this.cameraShake *= 0.9;
               if (this.cameraShake < 0.01) this.cameraShake = 0;
            }
            if (this.flashIntensity > 0) {
               this.flashIntensity -= dt * 2;
               if(this.flashIntensity < 0) this.flashIntensity = 0;
            }
            this.postMaterial.uniforms.flash.value = this.flashIntensity;
        }

        // Bullets process
        for(let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            if (b.userData.type === 'smoke') {
                b.userData.life -= dt;
                b.scale.addScalar(dt * 20);
                (b.material as THREE.MeshBasicMaterial).opacity = b.userData.life;
                if (b.userData.life <= 0) {
                    this.scene.remove(b);
                    this.bullets.splice(i, 1);
                }
            } else if (b.userData.type === 'debris') {
                b.userData.life -= dt;
                b.userData.velocity.y -= 300 * dt; // gravity
                b.position.addScaledVector(b.userData.velocity, dt);
                b.rotation.x += dt * 5;
                b.rotation.y += dt * 5;
                if (b.userData.life <= 0 || b.position.y < -500) {
                    this.scene.remove(b);
                    this.bullets.splice(i, 1);
                }
            } else if (b.userData.type === 'missile') {
                const dir = new THREE.Vector3().subVectors(b.userData.target, b.position);
                const dist = dir.length();
                dir.normalize();
                const step = Math.min(dist, dt * b.userData.speed);
                b.position.add(dir.multiplyScalar(step));
                b.lookAt(b.userData.target);
                
                if(Math.random() > 0.3) this.addSmoke(b.position);

                if (dist < 10) {
                    this.flashIntensity = 1.0; 
                    playHaptic('explosion');
                    for(let k=0; k<25; k++) this.addDebris(b.position);

                    this.scene.remove(b);
                    this.bullets.splice(i, 1);

                    for(let j=0; j<this.enemyTowers.length; j++) {
                        const tower = this.enemyTowers[j];
                        if (tower.active && tower.mesh.position.distanceTo(b.userData.target) < 150) {
                            tower.hp -= 100;
                            if (tower.hp <= 0) {
                                tower.active = false;
                                tower.mesh.position.y = -9999;
                                this.onScore(1500, Math.floor(Math.random() * 5) + 5);
                            }
                        }
                    }
                }
            } else {
                 b.position.addScaledVector(b.userData.velocity, dt);
                 if (b.position.distanceTo(this.camera.position) > 4000) {
                    this.scene.remove(b);
                    this.bullets.splice(i, 1);
                 } else {
                     for(let j=0; j<this.enemyTowers.length; j++) {
                        const tower = this.enemyTowers[j];
                        if (tower.active && tower.mesh.position.distanceTo(b.position) < 40) {
                            tower.hp -= 35;
                            if (tower.hp <= 0) {
                                tower.active = false;
                                tower.mesh.position.y = -9999;
                                playHaptic('explosion');
                                this.flashIntensity = 0.2; 
                                this.onScore(500, Math.floor(Math.random() * 5) + 1);
                            }
                            this.scene.remove(b);
                            this.bullets.splice(i, 1);
                            break;
                        }
                    }
                 }
            }
        }
        
        if (this.combatPhase === 'SPACE') {
            const tx = this.camera.position.x;
            const tz = this.camera.position.z;
            let groundHeight = terrainNoise(tx, tz);
            if (groundHeight < -100) groundHeight = -100 + (groundHeight + 100) * 0.2;
            groundHeight -= 400;

            if (this.camera.position.y - groundHeight < 20 && this.speed > 50) {
                this.shipHealth -= 20 * dt;
            }

            if (this.shipHealth <= 0) {
                this.combatPhase = 'SPACE';
                this.onPhaseChange('SPACE');
                this.appMode = 'HANGAR';
                this.shipGroup.visible = true;
                this.onRetreat();
                this.shipHealth = 100;
            }
        }

        // Render pass
        if (this.combatPhase === 'DRONE') {
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
            if (this.shipGroup.visible) {
                this.renderer.render(this.fgScene, this.fgCamera);
            }
        }
    }
  };

  private onWindowResize = () => {
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w < h) { [w, h] = [h, w]; }
    this.renderer.setSize(w, h);
    if (this.rtTexture) this.rtTexture.setSize(w, h);
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

// --------------------------------------------------------
// 5. MAIN REACT APP
// --------------------------------------------------------
export default function App() {
  type AppState = 'AUTH'|'SPLASH1'|'SPLASH2'|'MAIN_MENU'|'PROFILE'|'GARAGE'|'MULTIPLAYER'|'VOUCHERS'|'WHEEL'|'GAME'|'FALLBACK';
  
  const [appState, setAppState] = useState<AppState>('AUTH');
  const [combatPhase, setCombatPhase] = useState<'SPACE' | 'DESCENDING' | 'DRONE'>('SPACE');
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [saveData, setSaveData] = useState<SaveState>(DEFAULT_SAVE);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GraphicEngine | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('sgrd_v11_save');
    if (saved) {
        setSaveData(JSON.parse(saved));
    }
  }, []);

  const saveGame = (data: SaveState) => {
      setSaveData(data);
      localStorage.setItem('sgrd_v11_save', JSON.stringify(data));
  };

  useEffect(() => {
    if ((appState === 'MAIN_MENU' || appState === 'GAME' || appState === 'GARAGE' || appState === 'PROFILE') && canvasRef.current && !engineRef.current) {
        engineRef.current = new GraphicEngine(canvasRef.current);
        return () => {
            engineRef.current?.dispose();
            engineRef.current = null;
        };
    }
    
    if (engineRef.current) {
        engineRef.current.appMode = (appState === 'GAME') ? 'GAME' : 'HANGAR';
        engineRef.current.applySkin(saveData.unlockedSkins.includes('SHARAB-GOLD-V10'));
        engineRef.current.onPhaseChange = (phase) => {
            setCombatPhase(phase as any);
        };
        engineRef.current.onScore = (pts, c) => {
            setSaveData(prev => {
                const next = { ...prev, score: prev.score + pts, crystals: prev.crystals + c };
                localStorage.setItem('sgrd_v11_save', JSON.stringify(next));
                return next;
            });
        };
        engineRef.current.onRetreat = () => {
            setAppState('FALLBACK');
        };
    }
  }, [appState, saveData.unlockedSkins]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    playHaptic('click');
    if (ACTIVATION_CODES.includes(code)) {
      try {
          if (document.documentElement.requestFullscreen) {
              await document.documentElement.requestFullscreen();
          }
          if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
              await window.screen.orientation.lock('landscape');
          }
      } catch (err) { }
      
      setAppState('SPLASH1');
      setTimeout(() => {
        setAppState('SPLASH2');
        setTimeout(() => {
          setAppState('MAIN_MENU');
          initAudio();
        }, 2500);
      }, 2500);
      
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  const processVoucher = () => {
      playHaptic('click');
      const v = OFFLINE_VOUCHERS[code];
      if (v) {
          if (v.type === 'skin' && !saveData.unlockedSkins.includes(code)) {
              saveGame({ ...saveData, unlockedSkins: [...saveData.unlockedSkins, code] });
              alert(`تم التفعيل: ${v.name}`);
          } else if (v.type === 'ammo') {
              saveGame({ ...saveData, infiniteAmmo: true });
              alert(`تم التفعيل: ${v.name}`);
          }
      } else {
          setError(true);
          setTimeout(() => setError(false), 2000);
      }
      setCode('');
  };

  const getRank = (score: number) => {
      if (score > 100000) return "جنرال شرعب العز";
      if (score > 50000) return "عقيد الفضاء";
      if (score > 20000) return "رائد النخبة";
      if (score > 5000) return "نقيب";
      return "ملازم مجرة";
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
    <div id="app-root" className="w-full h-full bg-[#0D0E10] text-white overflow-hidden select-none touch-none font-sans relative" dir="rtl">
      
      {appState === 'AUTH' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D0E10] z-50 p-6">
           <div className="w-full max-w-md border border-[#00FFFF]/30 bg-black/80 p-8 shadow-[0_0_50px_rgba(0,255,255,0.1)]">
              <h1 className="text-3xl font-black text-[#00FFFF] mb-2 tracking-widest text-center" dir="ltr">SYSTEM LOCK</h1>
              <p className="text-gray-400 text-sm mb-8 text-center" dir="ltr">ENTER 9-CODE AUTHORIZATION</p>
              
              <form onSubmit={handleAuth} className="flex flex-col gap-4">
                <input 
                  type="text" 
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX"
                  dir="ltr"
                  className={`w-full bg-black border ${error ? 'border-[#FF0055] text-[#FF0055]' : 'border-[#00FFFF] text-[#00FFFF]'} p-4 text-center text-xl tracking-widest outline-none shadow-[inset_0_0_10px_rgba(0,255,255,0.2)]`}
                />
                <button type="submit" className="w-full bg-[#00FFFF]/20 border border-[#00FFFF] text-[#00FFFF] hover:bg-[#00FFFF] hover:text-black font-bold p-4 tracking-widest transition-colors mt-4">
                  فك التشفير
                </button>
              </form>
           </div>
        </div>
      )}

      {appState === 'SPLASH1' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50 animate-pulse">
           <h1 className="text-4xl md:text-6xl font-black tracking-[0.5em] text-white drop-shadow-[0_0_15px_#FFFFFF] text-center" dir="ltr">
             TANKEEL-X<br/>
             <span className="text-xl md:text-2xl text-gray-400 font-light tracking-[0.3em] mt-4 block">Cinematic Space Odyssey</span>
           </h1>
        </div>
      )}

      {appState === 'SPLASH2' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
           <h2 className="text-3xl md:text-5xl font-black tracking-widest text-[#00FF66] drop-shadow-[0_0_20px_#00FF66]">
             المهندس: سهيل الهزبري
           </h2>
        </div>
      )}

      {(appState === 'MAIN_MENU' || appState === 'GAME' || appState === 'PROFILE' || appState === 'GARAGE') && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      )}

      {appState === 'MAIN_MENU' && (
        <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent to-transparent flex flex-col justify-center p-12 z-20">
           <h1 className="text-5xl font-black text-white mb-2 drop-shadow-lg" dir="ltr">SGRD: SHARAB</h1>
           <p className="text-xl text-[#00FFFF] mb-12">الصحوة - الإصدار 11.0</p>
           
           <div className="flex flex-col gap-4 w-64">
               <button onClick={() => { playHaptic('click'); setAppState('GAME'); setCombatPhase('SPACE'); }} className="bg-[#00FFFF]/20 border border-[#00FFFF] text-[#00FFFF] p-4 font-bold text-lg hover:bg-[#00FFFF] hover:text-black transition-colors text-right flex items-center justify-between">
                   <span>بدء المهمة الأرضية</span>
               </button>
               <button onClick={() => { playHaptic('click'); setAppState('GARAGE'); }} className="bg-black/50 border border-gray-600 text-white p-4 font-bold hover:border-[#00FFFF] transition-colors text-right">
                   الجراج التكتيكي
               </button>
               <button onClick={() => { playHaptic('click'); setAppState('PROFILE'); }} className="bg-black/50 border border-gray-600 text-white p-4 font-bold hover:border-[#00FFFF] transition-colors text-right">
                   الملف الشخصي
               </button>
               <button onClick={() => { playHaptic('click'); setAppState('MULTIPLAYER'); }} className="bg-black/50 border border-gray-600 text-[#00FF66] p-4 font-bold hover:border-[#00FF66] transition-colors text-right">
                   اللعب الجماعي المحلي
               </button>
               <button onClick={() => { playHaptic('click'); setAppState('WHEEL'); }} className="bg-black/50 border border-gray-600 text-[#FFD700] p-4 font-bold hover:border-[#FFD700] transition-colors text-right">
                   عجلة الحظ اليومية
               </button>
               <button onClick={() => { playHaptic('click'); setAppState('VOUCHERS'); }} className="bg-black/50 border border-gray-600 text-[#FF0055] p-3 font-bold hover:border-[#FF0055] transition-colors text-right text-sm">
                   الشفرات الخاصة والموارد
               </button>
           </div>
           
           <div className="absolute top-6 left-6 text-right">
               <div className="text-2xl font-black text-[#00FFFF]" dir="ltr">💎 {saveData.crystals}</div>
               <div className="text-sm text-gray-400 font-mono" dir="ltr">SCORE: {saveData.score}</div>
           </div>
        </div>
      )}

      {appState === 'PROFILE' && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-8 z-30">
            <div className="border border-[#00FFFF] bg-black/90 p-8 w-full max-w-md">
                <h2 className="text-3xl text-[#00FFFF] font-black mb-6">الملف الشخصي</h2>
                <div className="mb-6">
                    <label className="block text-gray-400 mb-2">اسم الطيار</label>
                    <input 
                       className="w-full bg-gray-900 border border-gray-700 p-3 text-white focus:border-[#00FFFF] outline-none" 
                       value={saveData.pilotName} 
                       onChange={e => saveGame({...saveData, pilotName: e.target.value})}
                    />
                </div>
                <div className="mb-8">
                    <div className="text-gray-400 mb-2">الرتبة العسكرية</div>
                    <div className="text-2xl font-bold text-[#FFD700]">{getRank(saveData.score)}</div>
                </div>
                <button onClick={() => { playHaptic('click'); setAppState('MAIN_MENU'); }} className="w-full bg-gray-800 text-white p-4 font-bold hover:bg-gray-700 transition">
                    حفظ والعودة
                </button>
            </div>
        </div>
      )}

      {appState === 'GARAGE' && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-8 z-30">
            <div className="border border-[#00FF66] bg-black/90 p-8 w-full max-w-lg">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-3xl text-[#00FF66] font-black">الجراج التكتيكي</h2>
                    <div className="text-xl text-[#00FFFF]" dir="ltr">💎 {saveData.crystals}</div>
                </div>
                
                {['plasma', 'missiles', 'engine'].map((key) => {
                    const level = saveData.upgrades[key as keyof typeof saveData.upgrades];
                    const cost = level * 1000;
                    return (
                        <div key={key} className="flex justify-between items-center bg-gray-900 border border-gray-700 p-4 mb-4">
                            <div>
                                <div className="text-lg font-bold text-white capitalize">{key === 'plasma' ? 'مدافع البلازما' : key === 'missiles' ? 'الصواريخ الحرارية' : 'محرك التسارع'}</div>
                                <div className="text-sm text-gray-400">المستوى: {level}</div>
                            </div>
                            <button 
                                onClick={() => {
                                    if (saveData.crystals >= cost) {
                                        playHaptic('upgrade');
                                        saveGame({
                                            ...saveData, 
                                            crystals: saveData.crystals - cost,
                                            upgrades: { ...saveData.upgrades, [key]: level + 1 }
                                        });
                                    } else {
                                        playHaptic('click');
                                    }
                                }}
                                className={`px-6 py-2 font-bold ${saveData.crystals >= cost ? 'bg-[#00FF66]/20 border border-[#00FF66] text-[#00FF66] hover:bg-[#00FF66] hover:text-black' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}
                            >
                                ترقية (💎 {cost})
                            </button>
                        </div>
                    );
                })}

                <button onClick={() => { playHaptic('click'); setAppState('MAIN_MENU'); }} className="w-full bg-gray-800 text-white p-4 font-bold hover:bg-gray-700 transition mt-4">
                    العودة للقيادة
                </button>
            </div>
        </div>
      )}

      {appState === 'MULTIPLAYER' && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-8 z-40 text-center">
            <h2 className="text-4xl text-[#00FFFF] font-black mb-8 border-b-2 border-[#00FFFF] pb-2">نظام اللعب الجماعي (P2P)</h2>
            <div className="animate-pulse w-32 h-32 rounded-full border-4 border-dashed border-[#00FF66] flex items-center justify-center mb-8 mx-auto">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00FF66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M2.5 9.289a15 15 0 0 1 19 0"/>
                </svg>
            </div>
            <p className="text-2xl mb-4 font-bold max-w-2xl text-center mx-auto">جاري البحث عن طيارين في أقرب نقطة اتصال...</p>
            <p className="text-gray-400 mb-8 max-w-md mx-auto text-center">
               قم بتشغيل نقطة الاتصال اللاسلكية للتزامن مع اللاعب الثاني كفريق مرافقة أو مدفعي خلفي بسرعة 60 إطار بالثانية بدون إنترنت.
            </p>
            <button onClick={() => { playHaptic('click'); setAppState('MAIN_MENU'); }} className="bg-gray-800 text-white px-8 py-4 border border-gray-600 hover:border-[#FF0055] hover:text-[#FF0055] font-bold text-lg transition-colors">
                إلغاء البحث والعودة
            </button>
        </div>
      )}

      {appState === 'VOUCHERS' && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-8 z-40">
           <div className="w-full max-w-md border border-[#FF0055] bg-black/80 p-8 shadow-[0_0_30px_rgba(255,0,85,0.2)] text-center">
              <h2 className="text-2xl font-black text-[#FF0055] mb-4">بطاقات الشحن الأرضية</h2>
              <p className="text-gray-400 text-sm mb-6">أدخل كود الشحن المحلي لفتح الموارد الخاصة</p>
              <input 
                  type="text" 
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  dir="ltr"
                  className={`w-full bg-black border ${error ? 'border-red-500 text-red-500' : 'border-gray-500 text-white'} p-4 text-center text-xl tracking-widest outline-none mb-4`}
              />
              <button onClick={processVoucher} className="w-full bg-[#FF0055]/20 border border-[#FF0055] text-[#FF0055] hover:bg-[#FF0055] hover:text-white font-bold p-4 transition-colors mb-4">
                  تفعيل المورد
              </button>
              <button onClick={() => { playHaptic('click'); setAppState('MAIN_MENU'); setCode(''); }} className="w-full border border-gray-600 text-gray-400 hover:text-white font-bold p-3 transition-colors">
                  العودة
              </button>
           </div>
        </div>
      )}

      {appState === 'WHEEL' && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-8 z-40 text-center">
            <h2 className="text-4xl text-[#FFD700] font-black mb-8">عجلة الدعم اللوجستي</h2>
            <div className="w-64 h-64 mx-auto border-8 border-gray-800 rounded-full flex items-center justify-center mb-8 bg-gradient-to-tr from-gray-900 to-black shadow-[0_0_50px_rgba(255,215,0,0.2)]">
                <span className="text-[#FFD700] text-6xl">💎</span>
            </div>
            <button 
                onClick={() => {
                    const now = Date.now();
                    if (now - saveData.lastLuckyWheelTimestamp > 86400000) {
                        playHaptic('upgrade');
                        const reward = Math.floor(Math.random() * 5000) + 1000;
                        alert(`مبروك! لقد عثرت على ${reward} كريستال طاقة!`);
                        saveGame({...saveData, crystals: saveData.crystals + reward, lastLuckyWheelTimestamp: now});
                        setAppState('MAIN_MENU');
                    } else {
                        playHaptic('click');
                        alert('عفواً، الدعم اللوجستي متاح مرة واحدة كل 24 ساعة.');
                    }
                }}
                className="bg-[#FFD700]/20 border border-[#FFD700] text-[#FFD700] px-12 py-4 font-black shadow-[0_0_20px_rgba(255,215,0,0.3)] hover:bg-[#FFD700] hover:text-black mb-6 transition-all"
            >
                سحب الموارد
            </button>
            <button onClick={() => { playHaptic('click'); setAppState('MAIN_MENU'); }} className="text-gray-400 hover:text-white font-bold">العودة للقيادة</button>
        </div>
      )}

      {appState === 'FALLBACK' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 z-50">
           <h1 className="text-5xl font-black text-[#FF0055] mb-4">تراجع تكتيكي</h1>
           <p className="text-xl text-gray-300 mb-8 max-w-2xl text-center leading-relaxed">
               تم رصد أضرار هيكلية خطيرة في المقاتلة. قمنا بسحبك تلقائياً إلى قاعدة شرعب بأمان. <br/>
               <span className="text-[#00FFFF]">متبقي لك مسافة قصيرة لفتح الترقية القادمة، استمر في الصمود!</span>
           </p>
           <button 
               onClick={() => { playHaptic('click'); setAppState('GARAGE'); }} 
               className="bg-[#00FFFF]/20 border border-[#00FFFF] text-[#00FFFF] px-12 py-5 hover:bg-[#00FFFF] hover:text-black font-black text-2xl transition-all shadow-[0_0_30px_rgba(0,255,255,0.3)]"
           >
               العودة للترقية
           </button>
        </div>
      )}

      {appState === 'GAME' && (
        <div className="relative w-full h-full z-10 pointer-events-none">
           
           {/* Space Flight Specific HUD */}
           {combatPhase === 'SPACE' && (
               <>
                 <div className="absolute top-20 left-1/2 -translate-x-1/2 pointer-events-auto z-20">
                     <button 
                         className="bg-[#FF0055]/30 border-2 border-[#FF0055] px-10 py-4 text-white font-black animate-pulse shadow-[0_0_20px_#ff0055] hover:bg-[#FF0055]"
                         onClick={() => { playHaptic('click'); engineRef.current?.triggerDescend(); }}
                     >
                         بدء الهبوط الجوي
                     </button>
                 </div>
                 
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30vh] h-[30vh] md:w-[40vh] md:h-[40vh] rounded-full border border-[#00FFFF]/30 pointer-events-none">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#00FFFF]/20 px-2 text-[#00FFFF] text-xs font-bold" dir="ltr">N</div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 bg-[#00FFFF]/20 px-2 text-[#00FFFF] text-xs font-bold" dir="ltr">S</div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 bg-[#00FFFF]/20 py-2 text-[#00FFFF] text-xs font-bold" style={{writingMode: 'vertical-rl'}} dir="ltr">W</div>
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 bg-[#00FFFF]/20 py-2 text-[#00FFFF] text-xs font-bold" style={{writingMode: 'vertical-rl'}} dir="ltr">E</div>
                    <div className="absolute inset-0 border-[0.5px] border-[#00FFFF]/10 rounded-full scale-75 border-dashed animate-spin-slow"></div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border border-[#00FF66]/50 flex items-center justify-center">
                      <div className="w-1 h-1 bg-[#00FF66]"></div>
                    </div>
                 </div>

                 <div className="absolute top-6 right-6 w-20 h-20 md:w-24 md:h-24 bg-black/50 border-2 border-[#00FFFF] rounded-full overflow-hidden flex items-center justify-center backdrop-blur-md shadow-[0_0_20px_rgba(0,255,255,0.3)]">
                     <svg viewBox="0 0 100 100" fill="none" stroke="#00FFFF" strokeWidth="2">
                         <circle cx="50" cy="40" r="20" fill="#1A1B1C" />
                         <path d="M 35 40 Q 50 50 65 40 L 70 30 L 30 30 Z" fill="#00FFFF" />
                         <path d="M 20 100 C 20 70, 80 70, 80 100 Z" fill="#1A1B1C" />
                     </svg>
                 </div>
                 
                 <div className="absolute top-6 right-32 text-right">
                     <div className="text-xl font-black text-[#00FFFF]">{saveData.pilotName}</div>
                     <div className="text-sm text-gray-300 bg-black/50 px-2 py-1 mt-1 border border-gray-700">{getRank(saveData.score)}</div>
                 </div>
                 
                 <div className="absolute top-6 left-6 text-[#00FFFF] font-mono text-sm tracking-widest opacity-80 pointer-events-none" dir="ltr">
                    <div>SYS.OP: OFFLINE KERNEL</div>
                    <div>PHASE: DEEP SPACE</div>
                    <div>SHARAB ALTITUDE: ORBITAL</div>
                 </div>
               </>
           )}

           {/* Drone Phase Specific HUD */}
           {combatPhase === 'DRONE' && (
               <>
                 <div className="absolute top-8 left-8 text-right bg-black/60 p-5 border-l-4 border-l-white font-mono z-20 w-64 shadow-[0_0_20px_rgba(255,255,255,0.1)]" dir="rtl">
                     <div className="text-lg text-white mb-3 font-black border-b border-white/30 pb-2">رؤية ليلية (FLIR) نشطة</div>
                     <div className="flex justify-between gap-4 mt-2">
                        <span className="text-gray-300">الارتفاع الإجرائي:</span> 
                        <span className="font-bold">850m</span>
                     </div>
                     <div className="flex justify-between gap-4 mt-1">
                        <span className="text-gray-300">قفل الصاروخ الحراري:</span> 
                        <span className="font-bold">مُفعل</span>
                     </div>
                     <div className="flex justify-between gap-4 mt-1">
                        <span className="text-gray-300">رادار الأهداف الأرضية:</span> 
                        <span className="font-bold">{saveData.crystals} أهداف</span>
                     </div>
                     <div className="flex justify-between gap-4 mt-3 pt-3 border-t border-white/20">
                        <span className="text-gray-300">حالة الوقود التكتيكي:</span> 
                        <span className="font-bold">98%</span>
                     </div>
                 </div>

                 <div className="absolute top-8 right-8 font-mono text-2xl tracking-[0.2em] z-20 flex items-center gap-2 bg-black/60 px-4 py-2 border border-white/20" dir="ltr">
                     REC <span className="animate-pulse text-white">●</span>
                 </div>

                 {/* Absolute Screen-Centered Tactical Crosshair */}
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] pointer-events-none flex items-center justify-center opacity-80">
                     <div className="absolute w-[80%] h-[80%] border-2 border-dotted border-white rounded-full animate-spin-slow opacity-60"></div>
                     <div className="absolute w-16 h-[2px] bg-white -left-12"></div>
                     <div className="absolute w-16 h-[2px] bg-white -right-12"></div>
                     <div className="absolute h-16 w-[2px] bg-white -top-12"></div>
                     <div className="absolute h-16 w-[2px] bg-white -bottom-12"></div>
                     
                     <div className="absolute -top-16 -left-16 w-8 h-8 border-t-4 border-l-4 border-white opacity-80"></div>
                     <div className="absolute -top-16 -right-16 w-8 h-8 border-t-4 border-r-4 border-white opacity-80"></div>
                     <div className="absolute -bottom-16 -left-16 w-8 h-8 border-b-4 border-l-4 border-white opacity-80"></div>
                     <div className="absolute -bottom-16 -right-16 w-8 h-8 border-b-4 border-r-4 border-white opacity-80"></div>
                     
                     <div className="w-1 h-1 bg-white rounded-full shadow-[0_0_10px_#ffffff] scale-150"></div>
                 </div>
               </>
           )}

           {/* Persistent Controls Overlay */}
           {combatPhase !== 'DESCENDING' && (
               <div className={`absolute bottom-6 left-6 right-6 flex justify-between items-end px-[24px] pointer-events-none transition-all duration-1000 ${combatPhase === 'DRONE' ? 'grayscale brightness-200' : ''}`}>
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
                     <div className="w-12 h-12 rounded-full bg-[#00FFFF]/50 shadow-[0_0_15px_#00FFFF] pointer-events-none"></div>
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
                     <div className="w-12 h-12 rounded-full bg-[#FF0055]/50 shadow-[0_0_15px_#FF0055] pointer-events-none"></div>
                  </div>
               </div>
           )}

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
