
import React from 'react';
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
}

const CharacterSelector: React.FC<CharacterSelectorProps> = ({ characters, onSelectCharacter, onCreateNew, onManageCharacter, isLoading = false }) => {
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
        <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
          <LoadingSpinner />
          <p className="text-white mt-4 text-lg font-semibold">Loading character...</p>
          <p className="text-gray-400 mt-2 text-sm">Loading conversation history and generating greeting</p>
        </div>
      )}
    </div>
  );
};

export default CharacterSelector;
