import React, { useEffect, useState } from 'react';

export default function Home({ onPlay }: { onPlay: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative w-full h-full bg-[#050810] text-white flex flex-col items-center overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1534447677768-be436bb09401?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80')] bg-cover bg-center opacity-20 mixing-blend-screen" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#050810]/50 to-[#050810] z-0" />

      <div className="absolute top-20 left-0 w-full h-[1px] bg-[#00FFFF]/30 z-10"></div>
      <div className="absolute top-0 left-16 w-[1px] h-full bg-[#00FFFF]/30 z-10"></div>
      
      <div className="mt-20 flex flex-col items-center z-10 w-full px-4">
        <h1 className="text-[5rem] md:text-[8rem] font-black text-[#FFFFFF] font-sans drop-shadow-[0_0_30px_rgba(0,255,255,0.7)] leading-none text-center">
          تَنكِيل
        </h1>
        <p className="text-[#FF4500] tracking-[0.3em] font-mono mt-2 text-sm md:text-lg text-center font-bold">
          GALACTIC DEFENSE PROTOCOL
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 z-20 w-full max-w-sm px-6">
        <button 
          onClick={onPlay}
          className={`w-full py-5 text-[#050810] font-black text-3xl font-sans bg-[#00FFFF] hover:bg-white hover:text-[#00FFFF] border border-transparent hover:border-[#00FFFF] transition-all duration-700 delay-300 transform ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'} shadow-[0_0_15px_rgba(0,255,255,0.6)]`}
          style={{clipPath: 'polygon(15px 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%, 0 15px)'}}
        >
          شاشة القيادة
        </button>
        
        <button 
          className={`w-[85%] py-4 text-[#FF4500] font-bold text-xl font-sans bg-gray-900 border border-gray-700 hover:border-[#FF4500] hover:bg-gray-800 transition-all duration-700 delay-500 transform ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
          style={{clipPath: 'polygon(15px 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%, 0 15px)'}}
        >
          ARMORY (الترسانة)
        </button>
        
        <button 
          className={`w-[70%] py-3 text-[#A0A0A0] font-bold text-lg font-sans bg-gray-900 border border-gray-700 hover:border-[#FF4500] hover:text-[#FF4500] hover:bg-gray-800 transition-all duration-700 delay-700 transform ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
          style={{clipPath: 'polygon(15px 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%, 0 15px)'}}
        >
          ABORT (خروج)
        </button>
      </div>

      <div className="absolute bottom-6 font-mono text-xs text-[#505070] z-10 w-full text-center">
        SYS.OP: SUHAIL AL-HIZAPRY // V1.0.0
      </div>
    </div>
  );
}
