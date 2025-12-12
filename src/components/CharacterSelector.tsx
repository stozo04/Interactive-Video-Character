
import React, { useEffect, useMemo, useState } from 'react';
import { CharacterProfile } from '../types';
import CharacterCard from './CharacterCard';
import LoadingSpinner from './LoadingSpinner';

interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

interface CharacterSelectorProps {
  characters: DisplayCharacter[];
  onSelectCharacter: (character: CharacterProfile) => void;
  onCreateNew: () => void;
  onManageCharacter: (character: CharacterProfile) => void;
  isLoading?: boolean;
  loadingCharacterName?: string | null;
}

const CharacterSelector: React.FC<CharacterSelectorProps> = ({ 
  characters, 
  onSelectCharacter, 
  onCreateNew, 
  onManageCharacter, 
  isLoading = false,
  loadingCharacterName = null,
}) => {
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isLoading) {
      setLoadingStartedAt(null);
      return;
    }

    setLoadingStartedAt(Date.now());
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [isLoading]);

  const stage = useMemo(() => {
    const elapsedMs = loadingStartedAt ? Math.max(0, now - loadingStartedAt) : 0;
    if (elapsedMs < 800) return 0;
    if (elapsedMs < 2000) return 1;
    if (elapsedMs < 3800) return 2;
    return 3;
  }, [loadingStartedAt, now]);

  const statusLine = useMemo(() => {
    switch (stage) {
      case 0:
        return 'Ringing…';
      case 1:
        return 'Connecting…';
      case 2:
        return 'Syncing context…';
      default:
        return 'Getting a greeting ready…';
    }
  }, [stage]);

  return (
    <div className="flex flex-col items-center justify-center h-full relative">
      <h2 className="text-3xl font-bold mb-8">Select a Character</h2>
      {characters.length === 0 ? (
        <p className="text-gray-400">You haven't created any characters yet. Get started by creating a new one!</p>
      ) : null}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 w-full max-w-7xl p-4 overflow-y-auto">
        {characters.map(char => (
          <div key={char.profile.id} className={isLoading ? 'pointer-events-none opacity-50' : ''}>
            <CharacterCard
              characterImageUrl={char.imageUrl}
              characterVideoUrl={char.videoUrl}
              onSelect={() => onSelectCharacter(char.profile)}
              onManage={(e) => {
                e.stopPropagation();
                onManageCharacter(char.profile);
              }}
            />
          </div>
        ))}
        <div
          onClick={isLoading ? undefined : onCreateNew}
          className={`aspect-[9/16] rounded-lg border-2 border-dashed border-gray-600 flex items-center justify-center ${
            isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-700/50 hover:border-purple-500'
          } transition-all text-gray-400 hover:text-white`}
        >
          <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4v16m8-8H4" />
            </svg>
            <p className="mt-2 font-semibold">Create New</p>
          </div>
        </div>
      </div>
      {isLoading && (
        <div 
          className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-50 px-6"
          role="status"
          aria-live="polite"
          aria-label="Connecting to character"
        >
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-full bg-purple-500/20 blur-xl animate-pulse" />
            <div className="relative w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M2 6.5C2 5.12 3.12 4 4.5 4h.7c.9 0 1.7.54 2.05 1.37l1.1 2.63c.26.62.12 1.34-.36 1.82l-1.2 1.2a14.9 14.9 0 006.76 6.76l1.2-1.2c.48-.48 1.2-.62 1.82-.36l2.63 1.1c.83.35 1.37 1.15 1.37 2.05v.7c0 1.38-1.12 2.5-2.5 2.5H19c-9.39 0-17-7.61-17-17V6.5z" />
              </svg>
            </div>
          </div>

          <p className="text-white text-xl font-semibold text-center">
            Calling {loadingCharacterName?.trim() ? loadingCharacterName : 'your character'}
            <span className="inline-flex w-6 justify-start" aria-hidden="true">
              <span className="ml-1">.</span>
              <span style={{ animationDelay: '120ms' }} className="animate-pulse">.</span>
              <span style={{ animationDelay: '240ms' }} className="animate-pulse">.</span>
            </span>
          </p>
          
          <p className="text-gray-300 mt-2 text-sm text-center">{statusLine}</p>

          <div className="mt-6 flex items-center gap-3 text-gray-400 text-xs">
            <LoadingSpinner />
            <span>Just a moment…</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterSelector;
