
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChatMessage, UploadedImage, CharacterProfile } from './types';
import * as geminiService from './services/geminiService';
// FIX: Corrected import syntax for dbService to resolve 'Cannot find name' errors.
import * as dbService from './services/cacheService';

import ApiKeySelector from './components/ApiKeySelector';
import ImageUploader from './components/ImageUploader';
import VideoPlayer from './components/VideoPlayer';
import ChatPanel from './components/ChatPanel';
import CharacterSelector from './components/CharacterSelector';
import LoadingSpinner from './components/LoadingSpinner';

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat';

// A type for characters that includes their profile and the temporary URLs for display
interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

const App: React.FC = () => {
  const [apiKeySelected, setApiKeySelected] = useState(false);
  const [isAiStudio, setIsAiStudio] = useState(false);
  const [view, setView] = useState<View>('loading');
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);
  const [idleVideoUrl, setIdleVideoUrl] = useState<string | null>(null);

  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [isGeneratingInitialVideo, setIsGeneratingInitialVideo] = useState(false);
  const [isGeneratingActionVideo, setIsGeneratingActionVideo] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkApiKey = useCallback(async () => {
    const isStudioEnv = typeof window.aistudio?.hasSelectedApiKey === 'function';
    setIsAiStudio(isStudioEnv);
    try {
      // In local dev, we check a manually set key. In AI Studio, we use the provided API.
      const hasKey = isStudioEnv
        ? await window.aistudio.hasSelectedApiKey()
        : !!window.process?.env?.API_KEY;
      setApiKeySelected(hasKey);
    } catch (error) {
      console.error("Error checking for API key:", error);
      setApiKeySelected(false);
    }
  }, []);

  const loadCharacters = useCallback(async () => {
    setView('loading');
    const savedCharacters = await dbService.getCharacters();
    setCharacters(savedCharacters.sort((a, b) => b.createdAt - a.createdAt));
    setView('selectCharacter');
  }, []);

  useEffect(() => {
    checkApiKey();
    loadCharacters();
  }, [checkApiKey, loadCharacters]);

  const displayCharacters = useMemo((): DisplayCharacter[] => {
    try {
      return characters.map(profile => ({
        profile,
        // Use base64 data URL for the image to avoid issues with File object serialization from IndexedDB.
        imageUrl: `data:${profile.image.mimeType};base64,${profile.image.base64}`,
        videoUrl: URL.createObjectURL(profile.idleVideo)
      }));
    } catch (e) {
      console.error("Error creating object URLs for character list:", e);
      setErrorMessage("Failed to load character data. Some characters may be corrupted.");
      return [];
    }
  }, [characters]);

  useEffect(() => {
    // Cleanup object URLs when component unmounts or characters change.
    return () => {
      displayCharacters.forEach(c => {
        // Only videoUrl needs to be revoked, as imageUrl is now a data URL.
        URL.revokeObjectURL(c.videoUrl);
      });
    };
  }, [displayCharacters]);

  const handleApiKeySelected = () => {
    setApiKeySelected(true);
    setErrorMessage(null); // Clear previous errors
  };
  
  const handleApiError = useCallback((error: any) => {
    let message = error instanceof Error ? error.message : String(error);
    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
        message = "You've made too many requests. Please wait a minute and try again.";
    }
    setErrorMessage(message);
    if (message.includes("Requested entity was not found") || message.toLowerCase().includes("api key not valid")) {
      // Clear the bad key for local dev environments
      if (window.process?.env) {
          delete window.process.env.API_KEY;
      }
      setApiKeySelected(false);
      setErrorMessage("API Key is invalid. Please select a new key or enter a valid one.");
    }
    setIsGeneratingInitialVideo(false);
    setIsGeneratingActionVideo(false);
  }, []);

  const handleImageUpload = (image: UploadedImage) => {
    setUploadedImage(image);
    setErrorMessage(null);
  };

  const handleCharacterCreated = async (image: UploadedImage, idleVideoBlob: Blob) => {
    try {
        const imageHash = await dbService.hashImage(image.base64);

        // Check if character with this image already exists
        const existingChar = characters.find(c => c.id === imageHash);
        if (existingChar) {
            alert("A character with this image already exists. Loading that character instead.");
            handleSelectCharacter(existingChar);
            return;
        }

        const newCharacter: CharacterProfile = {
            id: imageHash,
            createdAt: Date.now(),
            image,
            idleVideo: idleVideoBlob,
        };
        await dbService.saveCharacter(newCharacter);
        setCharacters(prev => [newCharacter, ...prev]);
        handleSelectCharacter(newCharacter);
    } catch (error) {
        console.error("Error saving character:", error);
        handleApiError(new Error("Failed to save the new character."));
    }
  };

  const handleGenerateInitialVideo = async () => {
    if (!uploadedImage) return;
    setIsGeneratingInitialVideo(true);
    setErrorMessage(null);
    try {
      const videoBlob = await geminiService.generateInitialVideo(uploadedImage);
      await handleCharacterCreated(uploadedImage, videoBlob);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsGeneratingInitialVideo(false);
    }
  };

  const handleSelectLocalVideo = async (videoFile: File) => {
    if (!uploadedImage) return;
    setIsGeneratingInitialVideo(true);
    setErrorMessage(null);
    try {
        await handleCharacterCreated(uploadedImage, videoFile);
    } catch (error) {
        console.error("Error processing local video:", error);
        handleApiError(new Error("There was a problem processing your video file."));
    } finally {
        setIsGeneratingInitialVideo(false);
    }
  };

  const handleSelectCharacter = async (character: CharacterProfile) => {
    setSelectedCharacter(character);
    const newIdleVideoUrl = URL.createObjectURL(character.idleVideo);
    setIdleVideoUrl(newIdleVideoUrl);
    setCurrentVideoUrl(newIdleVideoUrl);
    setChatHistory([{ role: 'model', text: 'Hello! What should I do next?' }]);
    setView('chat');
  };

  const handleDeleteCharacter = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this character?")) {
        await dbService.deleteCharacter(id);
        setCharacters(prev => prev.filter(c => c.id !== id));
    }
  };

  const handleBackToSelection = () => {
    // Revoke the idle video URL when going back.
    if (idleVideoUrl) {
      URL.revokeObjectURL(idleVideoUrl);
    }
    // Also revoke the current action video if it's different and exists.
    if (currentVideoUrl && currentVideoUrl !== idleVideoUrl) {
        URL.revokeObjectURL(currentVideoUrl);
    }
    
    // Reset all session-specific states
    setSelectedCharacter(null);
    setIdleVideoUrl(null);
    setCurrentVideoUrl(null);
    setChatHistory([]);
    setUploadedImage(null);
    setErrorMessage(null);
    setView('selectCharacter');
  }

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter) return;
    setErrorMessage(null);
    setIsGeneratingActionVideo(true);
    
    // Add user message to history immediately
    setChatHistory(prev => [...prev, { role: 'user', text: message }]);

    try {
      // Generate video based on the user's command
      const videoUrl = await geminiService.generateActionVideo(selectedCharacter.image, message);
      
      // Revoke previous action video URL if it exists to prevent memory leaks.
      if (currentVideoUrl && currentVideoUrl !== idleVideoUrl) {
          URL.revokeObjectURL(currentVideoUrl);
      }

      // Update the UI with the new video
      setCurrentVideoUrl(videoUrl);

    } catch (error) {
      handleApiError(error);
    } finally {
        // Ensure loading states are reset regardless of success or failure.
        setIsGeneratingActionVideo(false);
    }
  };
  
  const isActionVideoPlaying = currentVideoUrl !== null && currentVideoUrl !== idleVideoUrl;

  const handleVideoEnd = () => {
    if (isActionVideoPlaying && idleVideoUrl) {
      // Revoke the object URL of the action video that just finished.
      if (currentVideoUrl) {
        URL.revokeObjectURL(currentVideoUrl);
      }
      setCurrentVideoUrl(idleVideoUrl);
    }
  };

  const isBusy = isGeneratingActionVideo || isGeneratingInitialVideo;

  const renderContent = () => {
    if (!apiKeySelected) {
      return <ApiKeySelector 
                onApiKeySelected={handleApiKeySelected} 
                errorMessage={errorMessage}
                isAiStudio={isAiStudio} 
              />;
    }
    
    switch (view) {
        case 'loading':
            return <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>;
        case 'selectCharacter':
            return <CharacterSelector 
                characters={displayCharacters}
                onSelectCharacter={handleSelectCharacter}
                onCreateNew={() => setView('createCharacter')}
                onDeleteCharacter={handleDeleteCharacter}
            />;
        case 'createCharacter':
            return (
              <ImageUploader 
                onImageUpload={handleImageUpload}
                onGenerate={handleGenerateInitialVideo}
                onSelectLocalVideo={handleSelectLocalVideo}
                imagePreview={uploadedImage?.base64 ? `data:${uploadedImage.mimeType};base64,${uploadedImage.base64}` : null}
                isUploading={isGeneratingInitialVideo}
                onBack={handleBackToSelection}
              />
            );
        case 'chat':
            if (!selectedCharacter) return null; // Should not happen
            return (
              <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
                <button 
                  onClick={handleBackToSelection} 
                  className="absolute top-2 left-2 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
                  aria-label="Back to character selection"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="lg:col-span-2 h-full flex items-center justify-center bg-black rounded-lg">
                  <VideoPlayer 
                    src={currentVideoUrl}
                    onEnded={handleVideoEnd}
                    isLoading={isGeneratingActionVideo}
                    loop={!isActionVideoPlaying}
                  />
                </div>
                <div className="h-full">
                  <ChatPanel
                    history={chatHistory}
                    onSendMessage={handleSendMessage}
                    isSending={isBusy}
                  />
                </div>
              </div>
            );
    }
  };

  return (
    <div className="bg-gray-900 text-gray-100 min-h-screen flex flex-col p-4 md:p-8">
      <header className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-600">
          Gemini Interactive Character
        </h1>
        <p className="text-gray-400 mt-2">Bring your images to life and chat with them in real-time.</p>
      </header>
      <main className="flex-grow bg-gray-800/50 rounded-2xl p-4 md:p-6 shadow-2xl shadow-black/30 backdrop-blur-sm border border-gray-700">
        {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-lg mb-4 text-center">{errorMessage}</div>}
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
