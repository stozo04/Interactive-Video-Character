
import React, { useState, useRef, useEffect } from 'react';

interface CharacterCardProps {
    characterImageUrl: string;
    characterVideoUrl: string;
    onSelect: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onManageActions: (e: React.MouseEvent) => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ characterImageUrl, characterVideoUrl, onSelect, onDelete, onManageActions }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        if (isHovered && videoRef.current) {
            videoRef.current.play().catch(() => {});
        } else if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
    }, [isHovered]);

    return (
        <div
            className="relative aspect-[9/16] rounded-lg overflow-hidden cursor-pointer group shadow-lg transition-transform transform hover:scale-105"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={onSelect}
        >
            <img 
                src={characterImageUrl} 
                alt="Character" 
                className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 group-hover:opacity-0"
                loading="lazy"
            />
            <video 
                ref={videoRef} 
                src={characterVideoUrl} 
                muted 
                loop 
                playsInline 
                className="absolute inset-0 w-full h-full object-cover" 
            />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <button 
                onClick={onDelete}
                className="absolute top-2 right-2 bg-red-600/70 text-white rounded-full p-1.5 hover:bg-red-500/90 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete character"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <button 
                onClick={onManageActions}
                className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-purple-600/80 text-white rounded-full px-3 py-1.5 hover:bg-purple-500/90 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-semibold flex items-center gap-1"
                aria-label="Manage actions"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Actions
            </button>
        </div>
    );
};

export default CharacterCard;
