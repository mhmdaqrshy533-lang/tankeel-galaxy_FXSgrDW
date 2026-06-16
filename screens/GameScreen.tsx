import React, { useEffect, useRef } from 'react';
import { GameEngine } from '../game/GameEngine';

export default function GameScreen({ chapter, onBack }: { chapter: number, onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new GameEngine(canvasRef.current, chapter);
    engine.start();

    return () => {
      engine.stop();
    };
  }, [chapter]);

  return (
    <div className="relative w-full h-full bg-black">
      <canvas 
        ref={canvasRef} 
        className="w-full h-full block"
        style={{ touchAction: 'none' }} // Crucial for multi-touch games
      />
      
      {/* Abort Button */}
      <button 
        onClick={onBack}
        className="absolute top-6 right-6 border border-[#FF4500]/50 text-[#FF4500] bg-black/50 px-6 py-2 text-sm font-sans font-bold hover:bg-[#FF4500] hover:text-black z-50 backdrop-blur shadow-[0_0_10px_rgba(255,69,0,0.3)] transition-colors"
        style={{clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)'}}
      >
        <div className="flex items-center gap-2">
            <span>ABORT</span>
            <span className="material-symbols-outlined text-sm">close</span>
        </div>
      </button>

      {/* Target Reticle visual overlay (pure CSS aesthetic) */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-[#00FFFF]/20 rounded-full pointer-events-none flex items-center justify-center">
        <div className="w-1 h-3 absolute top-0 bg-[#00FFFF]/50"></div>
        <div className="w-1 h-3 absolute bottom-0 bg-[#00FFFF]/50"></div>
        <div className="w-3 h-1 absolute left-0 bg-[#00FFFF]/50"></div>
        <div className="w-3 h-1 absolute right-0 bg-[#00FFFF]/50"></div>
      </div>
    </div>
  );
}
