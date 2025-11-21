
import React, { useState, useRef, useEffect } from 'react';

interface CharacterCardProps {
    characterImageUrl: string;
    characterVideoUrl: string;
    onSelect: () => void;
    onManage: (e: React.MouseEvent) => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ characterImageUrl, characterVideoUrl, onSelect, onManage }) => {
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
                onClick={onManage}
                className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-full px-6 py-2.5 opacity-0 group-hover:opacity-100 transition-all font-bold text-sm shadow-lg flex items-center gap-2"
                aria-label="Manage character"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                MANAGE
            </button>
        </div>
    );
};

export default CharacterCard;
