import { Star, Enemy } from './entities/Entities';
import { SaveSystem } from './storage/SaveSystem';
import { AudioEngine } from './audio/AudioEngine';

class InputState {
  up = false; down = false; left = false; right = false;
  fire = false; missile = false; evade = false; transform = false;
}

export class GameEngine {
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private lastTime = 0;
  
  private cx = 0; private cy = 0;
  private input = new InputState();

  // Rects for touch controls
  private leftBtn: Path2D = new Path2D();
  private rightBtn: Path2D = new Path2D();
  private upBtn: Path2D = new Path2D();
  private downBtn: Path2D = new Path2D();
  private fireBtn: Path2D = new Path2D();
  private evadeBtn: Path2D = new Path2D();
  private transformBtn: Path2D = new Path2D();

  // Game state
  private playerX = 0;
  private playerY = 0;
  private playerVx = 0;
  private playerVy = 0;
  private vehicleMode: 'ship' | 'car' = 'ship';
  private transformAnim = 0; // 0 to 1
  private isTransforming = false;
  
  private health = 100;
  private score = 0;
  private chapterId: number;
  
  private bullets: {x:number, y:number, vy:number, isEnemy:boolean, type:'laser'|'plasma'}[] = [];
  private enemies: Enemy[] = [];
  private particles: {x:number, y:number, vx:number, vy:number, life:number, maxLife:number, color:string}[] = [];
  private stars: Star[] = [];

  private lastShot = 0;
  private audio: AudioEngine;

  constructor(private canvas: HTMLCanvasElement, chapter: number) {
    this.ctx = canvas.getContext('2d')!;
    this.chapterId = chapter;
    this.resize();
    window.addEventListener('resize', this.resize);
    
    this.playerX = this.cx / 2;
    this.playerY = this.cy * 0.75;

    for(let i=0; i<150; i++) {
        this.stars.push(new Star(this.cx, this.cy));
    }

    this.setupControls();
    
    // Setup listeners
    this.canvas.addEventListener('pointerdown', this.handlePointer);
    this.canvas.addEventListener('pointermove', this.handlePointer);
    this.canvas.addEventListener('pointerup', this.handlePointer);
    this.canvas.addEventListener('pointercancel', this.handlePointer);

    this.audio = new AudioEngine();
    this.audio.init();
  }

  private resize = () => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.cx = this.canvas.width;
    this.cy = this.canvas.height;
    this.setupControls();
  };

  private setupControls() {
    const unit = Math.min(this.cy / 5, 80);
    const dCx = unit * 2.5; 
    const dCy = this.cy - unit * 1.5;

    this.upBtn = new Path2D(); this.upBtn.rect(dCx - unit*0.5, dCy - unit, unit, unit);
    this.downBtn = new Path2D(); this.downBtn.rect(dCx - unit*0.5, dCy, unit, unit);
    this.leftBtn = new Path2D(); this.leftBtn.rect(dCx - unit, dCy - unit*0.5, unit, unit);
    this.rightBtn = new Path2D(); this.rightBtn.rect(dCx, dCy - unit*0.5, unit, unit);

    const aCx = this.cx - unit * 2.5; 
    const aCy = this.cy - unit * 1.5;
    this.fireBtn = new Path2D(); this.fireBtn.rect(aCx - unit, aCy - unit*1.2, unit*2, unit*1.1);
    this.evadeBtn = new Path2D(); this.evadeBtn.rect(aCx - unit*1.2, aCy + unit*0.1, unit*1.2, unit*0.8);
    this.transformBtn = new Path2D(); this.transformBtn.rect(aCx + unit*0.2, aCy + unit*0.1, unit*1.2, unit*0.8);
  }

  private setInputFromPointers(e: PointerEvent) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (e.type === 'pointerup' || e.type === 'pointercancel') {
          this.input.up = false; this.input.down = false; this.input.left = false; this.input.right = false;
          this.input.fire = false; this.input.evade = false; this.input.transform = false;
          return;
      }

      this.input.up = this.ctx.isPointInPath(this.upBtn, x, y);
      this.input.down = this.ctx.isPointInPath(this.downBtn, x, y);
      this.input.left = this.ctx.isPointInPath(this.leftBtn, x, y);
      this.input.right = this.ctx.isPointInPath(this.rightBtn, x, y);
      this.input.fire = this.ctx.isPointInPath(this.fireBtn, x, y);
      this.input.evade = this.ctx.isPointInPath(this.evadeBtn, x, y);

      const hitTransform = this.ctx.isPointInPath(this.transformBtn, x, y);
      if (hitTransform && !this.input.transform && !this.isTransforming) {
         this.isTransforming = true;
         // Toggle mode
         this.vehicleMode = this.vehicleMode === 'ship' ? 'car' : 'ship';
      }
      this.input.transform = hitTransform;
  }

  private handlePointer = (e: PointerEvent) => {
    e.preventDefault();
    if(this.audio) this.audio.resume(); // Ensure audio context resumes on user interaction
    this.setInputFromPointers(e);
  };

  public start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  public stop() {
    this.running = false;
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointerdown', this.handlePointer);
    this.canvas.removeEventListener('pointermove', this.handlePointer);
    this.canvas.removeEventListener('pointerup', this.handlePointer);
    this.canvas.removeEventListener('pointercancel', this.handlePointer);

    if (this.score > 0) {
       SaveSystem.awardCredits(this.score);
    }
  }

  private loop = (time: number) => {
    if (!this.running) return;
    const dt = (time - this.lastTime) / 1000;
    this.lastTime = time;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.loop);
  }

  private update(dt: number) {
    if (this.isTransforming) {
        this.transformAnim += dt * 2.0;
        if (this.transformAnim >= 1.0) {
            this.transformAnim = 0;
            this.isTransforming = false;
        }
    }

    const modeSpeed = this.vehicleMode === 'ship' ? 1200 : 800;
    const acc = modeSpeed * dt;
    const friction = this.vehicleMode === 'ship' ? 0.9 : 0.85; // car stops faster

    if (this.input.left) this.playerVx -= acc;
    if (this.input.right) this.playerVx += acc;
    if (this.input.up) this.playerVy -= acc;
    if (this.input.down) this.playerVy += acc;

    this.playerVx *= friction;
    this.playerVy *= friction;
    this.playerX += this.playerVx * dt;
    this.playerY += this.playerVy * dt;

    if (this.playerX < 0) this.playerX = 0;
    if (this.playerX > this.cx) this.playerX = this.cx;
    if (this.playerY < 0) this.playerY = 0;
    if (this.playerY > this.cy) this.playerY = this.cy;

    if (this.input.fire && performance.now() - this.lastShot > (this.vehicleMode === 'ship' ? 150 : 250)) {
        this.audio.playLaser();
        const yOffset = this.vehicleMode === 'ship' ? 20 : 0;
        this.bullets.push({x: this.playerX - 10, y: this.playerY - yOffset, vy: -1000, isEnemy: false, type: 'laser'});
        this.bullets.push({x: this.playerX + 10, y: this.playerY - yOffset, vy: -1000, isEnemy: false, type: 'laser'});
        this.lastShot = performance.now();
    }

    if (Math.random() < 0.02) {
        this.enemies.push(new Enemy(this.cx, this.cy));
    }

    this.stars.forEach(s => s.update(this.playerVy * 0.05 + (this.vehicleMode==='ship' ? 5 : 2)));
    this.enemies.forEach(e => {
        e.update();
        if (Math.random() < 0.01) {
            this.bullets.push({x: e.x, y: e.y + 20, vy: 500, isEnemy: true, type: 'plasma'});
        }
    });
    this.enemies = this.enemies.filter(e => e.y < this.cy + 100 && e.hp > 0);

    this.bullets.forEach(b => {
        b.y += b.vy * dt;
    });
    this.bullets = this.bullets.filter(b => b.y > -100 && b.y < this.cy + 100);

    // Collisions
    this.bullets.forEach(b => {
        if (!b.isEnemy) {
            this.enemies.forEach(e => {
                let dx = b.x - e.x;
                let dy = b.y - e.y;
                if (Math.sqrt(dx*dx + dy*dy) < 40) {
                    e.hp -= 20;
                    b.y = -1000;
                    this.createExplosion(b.x, b.y, 5, '#FFFF00');
                    if (e.hp <= 0) {
                        this.score += 100;
                        this.createExplosion(e.x, e.y, 30, '#FF4500');
                        this.audio.playExplosion();
                    }
                }
            });
        } else {
            let dx = b.x - this.playerX;
            let dy = b.y - this.playerY;
            if (Math.sqrt(dx*dx + dy*dy) < 20) {
                this.health -= 10;
                b.y = 10000;
                this.createExplosion(this.playerX, this.playerY, 15, '#00FFFF');
                this.audio.playExplosion();
            }
        }
    });

    this.particles.forEach(p => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
    });
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private createExplosion(x: number, y: number, count: number, color: string) {
      for(let i=0; i<count; i++) {
          this.particles.push({
              x, y, 
              vx: (Math.random() - 0.5) * 400,
              vy: (Math.random() - 0.5) * 400,
              life: Math.random() * 0.5 + 0.2,
              maxLife: 0.7,
              color
          });
      }
  }

  private getPlanetTheme() {
      // 1: Training, 2: Desert, 3: Forest, 4: Mountains, 5: Earth
      switch(this.chapterId) {
          case 1: return { bg: '#050810', terrain: null };
          case 2: return { bg: '#2A1000', terrain: '#D2691E' };
          case 3: return { bg: '#001A00', terrain: '#228B22' };
          case 4: return { bg: '#1A1A1A', terrain: '#708090' };
          case 5: return { bg: '#001133', terrain: '#4682B4' };
          default: return { bg: '#050810', terrain: null };
      }
  }

  private drawPlayer() {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(this.playerX, this.playerY);

      let tilt = this.playerVx * 0.05;
      ctx.rotate(tilt * Math.PI / 180);

      const anim = this.isTransforming ? this.transformAnim : 0;
      const tShip = this.vehicleMode === 'ship' ? (1 - anim) : anim;
      const tCar = 1 - tShip;

      // Draw Ship
      if (tShip > 0) {
          ctx.save();
          ctx.globalAlpha = tShip;
          ctx.scale(1 + tShip*0.2, 1 + tShip*0.2);
          ctx.fillStyle = '#1A365D';
          ctx.strokeStyle = '#00FFFF';
          ctx.lineWidth = 2;

          ctx.beginPath();
          ctx.moveTo(0, -40);
          ctx.lineTo(10, -10);
          ctx.lineTo(30, 10);
          ctx.lineTo(10, 15);
          ctx.lineTo(5, 30);
          ctx.lineTo(-5, 30);
          ctx.lineTo(-10, 15);
          ctx.lineTo(-30, 10);
          ctx.lineTo(-10, -10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#0BC5EA';
          ctx.beginPath();
          ctx.ellipse(0, -5, 4, 12, 0, 0, Math.PI * 2);
          ctx.fill();

          if(this.input.up) {
              ctx.fillStyle = '#00FFFF';
              ctx.beginPath();
              ctx.arc(0, 35, 8 + Math.random()*5, 0, Math.PI*2);
              ctx.fill();
          }
          ctx.restore();
      }

      // Draw Car
      if (tCar > 0) {
          ctx.save();
          ctx.globalAlpha = tCar;
          // Car shape
          ctx.fillStyle = '#111';
          ctx.strokeStyle = '#FF4500';
          ctx.lineWidth = 2;

          // Body
          ctx.fillRect(-15, -20, 30, 40);
          ctx.strokeRect(-15, -20, 30, 40);
          
          // Wheels
          ctx.fillStyle = '#444';
          ctx.fillRect(-20, -15, 6, 10);
          ctx.fillRect(14, -15, 6, 10);
          ctx.fillRect(-20, 10, 6, 10);
          ctx.fillRect(14, 10, 6, 10);

          // Canopy
          ctx.fillStyle = '#0BC5EA';
          ctx.fillRect(-10, -10, 20, 15);

          // Headlights
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.moveTo(-10, -20);
          ctx.lineTo(-20, -60);
          ctx.lineTo(0, -60);
          ctx.fill();
          
          ctx.beginPath();
          ctx.moveTo(10, -20);
          ctx.lineTo(20, -60);
          ctx.lineTo(0, -60);
          ctx.fill();

          ctx.restore();
      }

      ctx.restore();
  }

  private draw() {
    const ctx = this.ctx;
    const theme = this.getPlanetTheme();

    // Background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.cx, this.cy);
    
    // Abstract terrain rendering
    if (theme.terrain) {
        ctx.fillStyle = theme.terrain;
        // Simple moving grid/ground effect based on player Y
        const yOffset = (this.playerY * 0.5) % 40;
        for (let i = 0; i < this.cy; i+=40) {
            ctx.fillRect(0, i + yOffset, this.cx, 2);
        }
    }

    this.stars.forEach(s => s.draw(ctx, this.playerVy * 0.05, this.cx, this.cy));
    this.enemies.forEach(e => e.draw(ctx));

    ctx.shadowBlur = 10;
    this.bullets.forEach(b => {
        ctx.shadowColor = b.isEnemy ? '#FF0000' : '#00FFFF';
        ctx.fillStyle = b.isEnemy ? '#FF0000' : '#00FFFF';
        ctx.fillRect(b.x - 2, b.y - 10, 4, 20);
    });
    ctx.shadowBlur = 0;

    this.drawPlayer();

    this.particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.random() * 4 + 2, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
    });

    // Draw HUD Buttons
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeStyle = 'rgba(0,255,255,0.4)';
    ctx.lineWidth = 2;
    [this.upBtn, this.downBtn, this.leftBtn, this.rightBtn, this.fireBtn].forEach(btn => {
        ctx.stroke(btn); ctx.fill(btn);
    });

    // Transform Button (Orange)
    ctx.strokeStyle = 'rgba(255,69,0,0.6)';
    ctx.stroke(this.transformBtn);
    ctx.fillStyle = this.isTransforming ? 'rgba(255,69,0,0.5)' : 'rgba(255,69,0,0.2)';
    ctx.fill(this.transformBtn);

    // Evade Button (Cyan)
    ctx.strokeStyle = 'rgba(0,255,255,0.6)';
    ctx.stroke(this.evadeBtn);
    ctx.fill(this.evadeBtn);
    
    // HUD Stats
    ctx.fillStyle = '#FFD700';
    ctx.font = '20px "JetBrains Mono", sans-serif';
    ctx.fillText(`SCORE: ${this.score}`, 20, 40);
    
    // Health Bar
    ctx.fillStyle = '#330000';
    ctx.fillRect(20, 50, 200, 10);
    ctx.fillStyle = this.health > 50 ? '#00FFFF' : (this.health > 25 ? '#FFD700' : '#FF0000');
    ctx.fillRect(20, 50, Math.max(0, this.health * 2), 10);
    ctx.strokeStyle = '#00FFFF';
    ctx.strokeRect(20, 50, 200, 10);

    // Dynamic warning
    if (this.health <= 25) {
        ctx.fillStyle = `rgba(255, 0, 0, ${Math.abs(Math.sin(performance.now() / 200))})`;
        ctx.font = '30px sans-serif';
        ctx.fillText('CRITICAL DAMAGE', this.cx/2 - 120, 100);
    }
  }
}
