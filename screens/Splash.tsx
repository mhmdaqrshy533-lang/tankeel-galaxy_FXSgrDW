import React, { useEffect, useState } from 'react';

export default function Splash({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 500);
    const t2 = setTimeout(() => setStage(2), 3000);
    const t3 = setTimeout(() => setStage(3), 4200);
    const t4 = setTimeout(() => setStage(4), 7000);
    const t5 = setTimeout(() => {
      setStage(5);
      onComplete();
    }, 10000);

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5);
    };
  }, [onComplete]);

  return (
    <div className="relative w-full h-full bg-[#050810] flex items-center justify-center font-mono overflow-hidden">
      {/* Dev Logo */}
      <h2 
        className={`absolute text-3xl md:text-5xl font-bold text-[#A0A0A0] tracking-[0.2em] transition-opacity duration-1000 z-10 ${stage === 1 ? 'opacity-100' : 'opacity-0'}`}
      >
        SUHAIL AL-HIZAPRY
      </h2>

      {/* Game Logo */}
      <div 
        className={`absolute flex flex-col items-center justify-center transition-all duration-1000 z-20 ${stage === 3 ? 'opacity-100 scale-110' : 'opacity-0 scale-100'} ${stage >= 4 ? 'opacity-0' : ''}`}
      >
        <h1 className="text-[5rem] md:text-[8rem] font-black text-[#00FFFF] font-sans tracking-tighter drop-shadow-[0_0_25px_rgba(0,255,255,0.8)] leading-none text-center">
          تَنكِيل
        </h1>
        <h2 className="text-3xl md:text-5xl font-bold text-[#FF4500] tracking-[0.3em] font-sans drop-shadow-[0_0_15px_rgba(255,69,0,0.8)] mt-2">
          SGMW
        </h2>
      </div>

      {/* Progress & Text */}
      <div 
        className={`absolute bottom-16 left-1/2 -translate-x-1/2 w-[80%] max-w-lg flex flex-col items-center gap-4 transition-opacity duration-500 z-30 ${stage >= 4 && stage < 5 ? 'opacity-100' : 'opacity-0'}`}
      >
        <p className="text-[#00FFFF] text-sm tracking-widest font-bold drop-shadow-[0_0_5px_#00FFFF]">
          INITIALIZING COMBAT SYSTEMS...
        </p>
        <div className="w-full h-5 bg-gray-900 border-2 border-[#00FFFF] rounded-sm overflow-hidden relative">
          {/* Scanline effect */}
          <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABZJREFUeNpi2rVq1X8GBgYQwgACMQgwAA28BBzEwzO/AAAAAElFTkSuQmCC')] opacity-30 z-10"></div>
          <div 
            className="h-full bg-[#00FFFF] transition-all duration-[2500ms] ease-in-out w-0 shadow-[0_0_15px_#00FFFF] relative z-0 flex items-center justify-end" 
            style={{ width: stage >= 4 ? '100%' : '0%' }}
          >
            <div className="w-2 h-full bg-white opacity-80" />
          </div>
        </div>
      </div>
    </div>
  );
}
