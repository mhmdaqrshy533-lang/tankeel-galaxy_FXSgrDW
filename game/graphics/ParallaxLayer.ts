export class ParallaxLayer {
  private y1: number;
  private y2: number;

  constructor(
    private color: string,
    private speed: number,
    private screenWidth: number,
    private screenHeight: number,
    private patternSize: number
  ) {
    this.y1 = 0;
    this.y2 = -screenHeight;
  }

  update() {
    this.y1 += this.speed;
    this.y2 += this.speed;

    if (this.y1 >= this.screenHeight) {
      this.y1 = this.y2 - this.screenHeight;
    }
    if (this.y2 >= this.screenHeight) {
      this.y2 = this.y1 - this.screenHeight;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color;
    // Draw some simple grid/pattern instead of a bitmap to make it look 2.5D
    ctx.beginPath();
    for(let x=0; x<this.screenWidth; x+=this.patternSize) {
       ctx.moveTo(x, this.y1); ctx.lineTo(x, this.y1 + this.screenHeight);
       ctx.moveTo(x, this.y2); ctx.lineTo(x, this.y2 + this.screenHeight);
    }
    for(let y=0; y<this.screenHeight; y+=this.patternSize) {
       ctx.moveTo(0, this.y1 + y); ctx.lineTo(this.screenWidth, this.y1 + y);
       ctx.moveTo(0, this.y2 + y); ctx.lineTo(this.screenWidth, this.y2 + y);
    }
    ctx.strokeStyle = this.color;
    ctx.stroke();
  }
}
