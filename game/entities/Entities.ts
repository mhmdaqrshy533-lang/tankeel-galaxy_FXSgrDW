export class Star {
  x: number;
  y: number;
  z: number;
  constructor(private sw: number, private sh: number) {
    this.x = (Math.random() - 0.5) * sw * 2;
    this.y = (Math.random() - 0.5) * sh * 2;
    this.z = Math.random() * 1000 + 100;
  }

  update(playerSpeed: number) {
    let warpSpeed = 6 + Math.abs(playerSpeed) * 0.5;
    this.z -= warpSpeed;
    if (this.z <= 0) {
      this.z = 1000;
      this.x = (Math.random() - 0.5) * this.sw * 2;
      this.y = (Math.random() - 0.5) * this.sh * 2;
    }
  }

  draw(ctx: CanvasRenderingContext2D, playerSpeed: number, sw: number, sh: number) {
    let sx = (this.x / this.z) * 200 + sw / 2;
    let sy = (this.y / this.z) * 200 + sh / 2;

    let size = (1 / this.z) * 5;
    if (size < 0.5) return;

    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, size * 100)})`;
    if (Math.abs(playerSpeed) > 15) {
      let prevZ = this.z + 6 + Math.abs(playerSpeed) * 0.5;
      let prevSx = (this.x / prevZ) * 200 + sw / 2;
      let prevSy = (this.y / prevZ) * 200 + sh / 2;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(prevSx, prevSy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export class Enemy {
  x: number;
  y: number;
  hp: number = 200;
  maxHp: number = 200;
  vx: number;
  vy: number = 1.5;
  scale = 1.0;
  width = 60;
  height = 60;
  
  constructor(private sw: number, private sh: number) {
    this.x = Math.random() * sw;
    this.y = -100;
    this.vx = (Math.random() > 0.5 ? 1 : -1) * 2;
  }

  update() {
    this.y += this.vy;
    this.x += this.vx;
    if (this.x < 30 || this.x > this.sw - 30) this.vx *= -1;
    this.scale = 0.4 + 0.8 * Math.max(0, Math.min(1, (this.y + this.height) / (this.sh + this.height)));
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);
    
    // Draw 2.5D stealth enemy
    ctx.fillStyle = '#1A1A1A';
    ctx.strokeStyle = '#FF4500';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(0, this.height/2); // Nose
    ctx.lineTo(this.width/2, -this.height/2); // Right wing tip
    ctx.lineTo(this.width/4, -this.height/4); // Right inner
    ctx.lineTo(0, -this.height/2); // Tail
    ctx.lineTo(-this.width/4, -this.height/4); // Left inner
    ctx.lineTo(-this.width/2, -this.height/2); // Left wing tip
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // HP Bar
    ctx.fillStyle = 'red';
    ctx.fillRect(this.x - 30, this.y - this.height/2 * this.scale - 10, 60 * (this.hp / this.maxHp), 4);
  }
}
