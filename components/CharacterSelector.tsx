
import React from 'react';
import { CharacterProfile } from '../types';
import CharacterCard from './CharacterCard';

interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

interface CharacterSelectorProps {
  characters: DisplayCharacter[];
  onSelectCharacter: (character: CharacterProfile) => void;
  onCreateNew: () => void;
  onDeleteCharacter: (id: string) => void;
}

const CharacterSelector: React.FC<CharacterSelectorProps> = ({ characters, onSelectCharacter, onCreateNew, onDeleteCharacter }) => {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <h2 className="text-3xl font-bold mb-8">Select a Character</h2>
      {characters.length === 0 ? (
        <p className="text-gray-400">You haven't created any characters yet. Get started by creating a new one!</p>
      ) : null}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 w-full max-w-7xl p-4 overflow-y-auto">
        {characters.map(char => (
          <CharacterCard
            key={char.profile.id}
            characterImageUrl={char.imageUrl}
            characterVideoUrl={char.videoUrl}
            onSelect={() => onSelectCharacter(char.profile)}
            onDelete={(e) => {
              e.stopPropagation();
              onDeleteCharacter(char.profile.id);
            }}
          />
        ))}
        <div
          onClick={onCreateNew}
          className="aspect-[9/16] rounded-lg border-2 border-dashed border-gray-600 flex items-center justify-center cursor-pointer hover:bg-gray-700/50 hover:border-purple-500 transition-all text-gray-400 hover:text-white"
        >
          <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4v16m8-8H4" />
            </svg>
            <p className="mt-2 font-semibold">Create New</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterSelector;
