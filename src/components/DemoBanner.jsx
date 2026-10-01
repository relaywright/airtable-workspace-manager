import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';

export function DemoBanner() {
  const { exitDemoMode } = useAppContext();
  const [isExiting, setIsExiting] = useState(false);

  const handleExit = async () => {
    setIsExiting(true);
    try {
      await exitDemoMode();
    } finally {
      setIsExiting(false);
    }
  };

  return (
    <div className="flex items-center justify-center gap-3 bg-accent/20 border-b border-accent/40 px-4 py-2 text-sm text-textPrimary">
      <span>You're viewing sample data from a fictional company.</span>
      <button
        onClick={handleExit}
        disabled={isExiting}
        className="px-3 py-1 bg-accent hover:bg-accentHover text-white rounded-lg text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isExiting ? 'Exiting...' : 'Exit sample data'}
      </button>
    </div>
  );
}

export default DemoBanner;
