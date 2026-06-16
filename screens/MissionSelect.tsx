import React, { useEffect, useState } from 'react';
import { SaveSystem, GameSaveData } from '../game/storage/SaveSystem';

const PLANETS = [
  { id: 1, name: 'TRAINING', nameAr: 'التدريب', desc: 'Sector: Space Academy', color: 'from-blue-500 to-cyan-500' },
  { id: 2, name: 'DESERT', nameAr: 'الصحراء', desc: 'Sector: Kepler-186f', color: 'from-orange-500 to-yellow-600' },
  { id: 3, name: 'FOREST', nameAr: 'الغابة', desc: 'Sector: Yavin IV', color: 'from-green-600 to-emerald-400' },
  { id: 4, name: 'MOUNTAINS', nameAr: 'الجبال', desc: 'Sector: Hoth Prime', color: 'from-gray-500 to-slate-300' },
  { id: 5, name: 'EARTH', nameAr: 'الأرض', desc: 'Sector: Terra', color: 'from-blue-600 to-green-500' }
];

export default function MissionSelect({ onSelect, onBack }: { onSelect: (chapter: number) => void, onBack: () => void }) {
  const [saveData, setSaveData] = useState<GameSaveData | null>(null);

  useEffect(() => {
    SaveSystem.load().then(setSaveData);
  }, []);

  if (!saveData) return null;

  return (
    <div className="relative w-full h-full bg-[#050810] flex flex-col p-4 md:p-8 overflow-hidden z-10">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1462331940025-496dfbfc7564?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80')] bg-cover bg-center opacity-10 z-0" />
      
      <div className="flex justify-between items-start z-10 relative">
        <h2 className="text-[#00FFFF] font-mono tracking-widest text-xs md:text-sm drop-shadow-[0_0_10px_#00FFFF] border-b border-[#00FFFF]/30 pb-2">
          SYSTEM SCAN // GALACTIC MAP<br/>
          <span className="text-[#FF4500] text-[10px]">SELECT DEPLOYMENT ZONE</span>
        </h2>
        <div className="text-[#FFD700] font-mono text-lg drop-shadow-[0_0_5px_#FFD700] bg-gray-900/50 px-4 py-1 border border-[#FFD700]/30 rounded">
          QC: {saveData.credits}
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden w-full flex items-center gap-8 z-10 relative mt-8 pb-20 px-8 snap-x snap-mandatory">
        {PLANETS.map((planet) => {
          const isUnlocked = saveData.unlockedPlanets.includes(planet.id);
          return (
            <div 
              key={planet.id}
              onClick={() => isUnlocked && onSelect(planet.id)}
              className={`snap-center shrink-0 w-64 md:w-80 h-[28rem] relative flex flex-col transition-all duration-500 ${isUnlocked ? 'cursor-pointer hover:scale-105' : 'cursor-not-allowed opacity-50 grayscale'}`}
            >
               {/* Planet visual */}
               <div className="flex-1 flex justify-center items-center relative">
                   {/* Glow */}
                   {isUnlocked && <div className={`absolute w-40 h-40 rounded-full bg-gradient-to-tr ${planet.color} blur-2xl opacity-40`} />}
                   {/* Sphere */}
                   <div className={`w-40 h-40 rounded-full bg-gradient-to-tr shadow-[inset_-20px_-20px_40px_rgba(0,0,0,0.8)] z-10 ${isUnlocked ? planet.color : 'from-gray-800 to-black border border-gray-600'}`}>
                       {!isUnlocked && <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 material-symbols-outlined text-4xl text-gray-500">lock</span>}
                   </div>
               </div>

               {/* Planet Info */}
               <div className="h-32 bg-gray-900/80 border border-[#00FFFF]/30 p-4 relative" style={{clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)'}}>
                  <div className="text-sm font-mono text-[#00FFFF] opacity-70">PLANET 0{planet.id}</div>
                  <div className="text-2xl font-black font-sans text-white mt-1">{planet.name} <span className="text-xl font-bold font-sans">({planet.nameAr})</span></div>
                  <div className="text-xs font-mono text-[#FF4500] mt-2">{isUnlocked ? planet.desc : 'RESTRICTED ACCESS'}</div>
               </div>
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-0 left-0 w-full bg-[#050810] border-t border-[#00FFFF]/20 h-20 flex p-3 gap-3 z-20">
        <button onClick={onBack} className="flex-1 bg-gray-900 text-[#00FFFF] border border-gray-700 hover:border-[#00FFFF] hover:bg-gray-800 font-sans font-bold text-sm md:text-base flex items-center justify-center gap-2">
          <span className="material-symbols-outlined">arrow_back</span> BACK
        </button>
        <button className="flex-1 bg-gray-900 text-[#00FFFF] border border-gray-700 hover:border-[#00FFFF] hover:bg-gray-800 font-sans font-bold text-sm md:text-base hidden sm:flex items-center justify-center gap-2">
           <span className="material-symbols-outlined">build</span> HANGAR
        </button>
        <button className="flex-1 bg-gray-900 text-[#FFD700] border border-gray-700 hover:border-[#FFD700] hover:bg-gray-800 font-sans font-bold text-sm md:text-base flex items-center justify-center gap-2">
           <span className="material-symbols-outlined">upgrade</span> UPGRADES
        </button>
        <button className="flex-1 bg-gray-900 text-[#FF4500] border border-gray-700 hover:border-[#FF4500] hover:bg-gray-800 font-sans font-bold text-sm md:text-base flex items-center justify-center gap-2">
           <span className="material-symbols-outlined">radar</span> INTEL
        </button>
      </div>
    </div>
  );
}
