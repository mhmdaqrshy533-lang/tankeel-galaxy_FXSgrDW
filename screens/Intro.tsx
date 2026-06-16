import React, { useEffect, useState } from 'react';

export default function Intro({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    let t1 = setTimeout(() => setStage(1), 100);
    let t2 = setTimeout(() => setStage(2), 2600); // Earth approach
    let t3 = setTimeout(() => setStage(3), 4100); // Reentry hit
    let t4 = setTimeout(() => setStage(4), 6100); // White flash
    let t5 = setTimeout(() => setStage(5), 7100); // Settle & show instructions

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
  }, []);

  return (
    <div className={`relative w-full h-full bg-black overflow-hidden ${stage === 3 ? 'animate-shake' : ''}`}>
      
      {/* Background Starfield */}
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80')] bg-cover opacity-30"></div>

      {/* Earth */}
      <div 
        className={`absolute bottom-[-50vh] left-1/2 -translate-x-1/2 w-[100vw] h-[100vw] rounded-full bg-[url('https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?auto=format&fit=crop&w=1000&q=80')] bg-cover shadow-[0_0_100px_#4A90E2] transition-transform ease-in ${
          stage === 0 ? 'scale-100 duration-0' : 
          stage === 1 ? 'scale-[2] duration-[3000ms]' : 
          stage === 2 || stage === 3 ? 'scale-[5] duration-[3000ms]' : 
          'scale-[25] duration-[1000ms] opacity-60'
        }`}
      />

      {/* Jet/Fighter */}
      {stage < 5 && (
        <div className={`absolute left-1/2 -ml-12 w-32 h-32 transition-transform ease-out z-10 ${stage === 0 ? '-top-32 duration-0' : 'top-1/3 duration-[2500ms]'}`}>
          {/* Simple Fighter SVG */}
          <svg viewBox="0 0 100 100" className="w-full h-full fill-gray-300 drop-shadow-[0_0_15px_rgba(0,255,255,0.8)]" transform="rotate(180)">
             <polygon points="50,10 90,90 50,70 10,90" fill="#1A365D"/>
             <polygon points="50,10 90,90 50,70" fill="#0BC5EA"/>
             {/* Engine */}
             <rect x="42" y="70" width="16" height="15" fill="#00FFFF" opacity="0.8"/>
          </svg>

          {/* Reentry Fire */}
          <div className={`absolute -bottom-16 left-1/2 -translate-x-1/2 w-48 h-32 bg-[#FF4500]/80 blur-2xl rounded-full transition-opacity ${stage === 3 ? 'opacity-100 animate-pulse' : 'opacity-0'}`}></div>
        </div>
      )}

      {/* Red Flash */}
      <div className={`absolute inset-0 bg-[#FF0000]/50 transition-opacity duration-200 pointer-events-none z-20 ${stage === 3 ? 'opacity-100' : 'opacity-0'}`}></div>
      
      {/* White Flash */}
      <div className={`absolute inset-0 bg-white transition-opacity duration-500 pointer-events-none z-30 ${stage === 4 ? 'opacity-100' : 'opacity-0'}`}></div>

      {/* Instructions */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center bg-black/80 transition-all duration-800 z-40 ${stage === 5 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20'}`}>
        <div className="border border-[#00FFFF]/50 p-8 w-full max-w-lg bg-gray-900/80 backdrop-blur shadow-[0_0_30px_rgba(0,255,255,0.2)]" style={{clipPath: 'polygon(20px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%, 0 20px)'}}>
          <h2 className="text-2xl font-bold font-sans text-[#00FFFF] mb-6 border-b border-[#00FFFF]/30 pb-2 text-center" dir="rtl">
            بدء بروتوكول القتال الفضائي
          </h2>
          <ul className="text-white font-sans space-y-4 mb-8 text-lg" dir="rtl">
            <li className="flex items-center gap-3">
              <span className="text-[#FFD700] text-2xl material-symbols-outlined">gamepad</span> 
              الإبهام الأيسر: التوجيه والمناورة
            </li>
            <li className="flex items-center gap-3">
              <span className="text-[#FF4500] text-2xl material-symbols-outlined">crisis_alert</span> 
              الإبهام الأيمن: إطلاق مدافع البلازما
            </li>
            <li className="flex items-center gap-3">
              <span className="text-[#00FFFF] text-2xl material-symbols-outlined">security</span> 
              زر التفادي: للالتفاف ونشر درع الطاقة
            </li>
          </ul>
          <button 
            onClick={onComplete}
            className="w-full py-4 bg-[#00FFFF]/20 text-[#00FFFF] border border-[#00FFFF] hover:bg-[#00FFFF] hover:text-black font-bold tracking-widest transition-colors font-sans text-xl shadow-[0_0_15px_rgba(0,255,255,0.4)]"
            style={{clipPath: 'polygon(15px 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%, 0 15px)'}}
          >
            ENGAGE (انطلاق)
          </button>
        </div>
      </div>
    </div>
  );
}
