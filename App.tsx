import React, { useState } from 'react';
import Splash from './screens/Splash';
import Home from './screens/Home';
import MissionSelect from './screens/MissionSelect';
import Intro from './screens/Intro';
import GameScreen from './screens/GameScreen';

export type ScreenState = 'SPLASH' | 'HOME' | 'MISSION_SELECT' | 'INTRO' | 'GAME';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('SPLASH');
  const [chapter, setChapter] = useState(1);

  const navigateTo = (screen: ScreenState) => setCurrentScreen(screen);

  return (
    <div className="w-full h-full overflow-hidden bg-black select-none">
      {currentScreen === 'SPLASH' && <Splash onComplete={() => navigateTo('HOME')} />}
      {currentScreen === 'HOME' && <Home onPlay={() => navigateTo('MISSION_SELECT')} />}
      {currentScreen === 'MISSION_SELECT' && (
        <MissionSelect 
          onSelect={(ch) => {
            setChapter(ch);
            navigateTo('INTRO');
          }} 
          onBack={() => navigateTo('HOME')}
        />
      )}
      {currentScreen === 'INTRO' && <Intro onComplete={() => navigateTo('GAME')} />}
      {currentScreen === 'GAME' && <GameScreen chapter={chapter} onBack={() => navigateTo('MISSION_SELECT')} />}
    </div>
  );
}
