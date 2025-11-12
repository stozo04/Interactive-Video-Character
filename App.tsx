import React, { useState, useEffect, useCallback } from 'react';
import { Chat } from '@google/genai';
import { ChatMessage, UploadedImage } from './types';
import * as geminiService from './services/geminiService';
import { hashImage, setVideoCache } from './services/cacheService';

import ApiKeySelector from './components/ApiKeySelector';
import ImageUploader from './components/ImageUploader';
import VideoPlayer from './components/VideoPlayer';
import ChatPanel from './components/ChatPanel';
import AudioPlayer from './components/AudioPlayer';

const App: React.FC = () => {
  const [apiKeySelected, setApiKeySelected] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [isGeneratingInitialVideo, setIsGeneratingInitialVideo] = useState(false);
  const [isGeneratingActionVideo, setIsGeneratingActionVideo] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [chatSession, setChatSession] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [initialVideoUrls, setInitialVideoUrls] = useState<string[] | null>(null);
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);
  const [actionAudioData, setActionAudioData] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkApiKey = useCallback(async () => {
    try {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setApiKeySelected(hasKey);
      // Fix: Wrapped the catch block's content in curly braces to fix a syntax error.
    } catch (error) {
      console.error("Error checking for API key:", error);
      setApiKeySelected(false);
    }
  }, []);

  useEffect(() => {
    checkApiKey();
  }, [checkApiKey]);

  const handleApiKeySelected = () => {
    setApiKeySelected(true);
  };
  
  const handleApiError = useCallback((error: any) => {
    let message = error instanceof Error ? error.message : String(error);
    
    // Check for rate limit error
    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
        message = "You've made too many requests in a short period. Please wait a minute and try creating a character again.";
    }

    setErrorMessage(message);
    if (message.includes("Requested entity was not found")) {
      setApiKeySelected(false);
      setErrorMessage("API Key is invalid. Please select a new key.");
    }
    setIsGeneratingInitialVideo(false);
    setIsGeneratingActionVideo(false);
    setIsChatting(false);
  }, []);

  const handleImageUpload = (image: UploadedImage) => {
    setUploadedImage(image);
    setErrorMessage(null);
  };

  const handleGenerateInitialVideo = async () => {
    if (!uploadedImage) return;
    setIsGeneratingInitialVideo(true);
    setErrorMessage(null);
    try {
      const { urls: videoUrls } = await geminiService.generateInitialVideo(uploadedImage);
      setInitialVideoUrls(videoUrls);
      setCurrentVideoUrl(videoUrls[0]);
      const session = await geminiService.startChatSession();
      setChatSession(session);
      setChatHistory([{ role: 'model', text: 'Hello! What should I do next?' }]);
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
      const videoUrl = URL.createObjectURL(videoFile);
      const imageHash = await hashImage(uploadedImage.base64);
      await setVideoCache(imageHash, [videoFile]);
      console.log("Local idle video saved to cache.");

      setInitialVideoUrls([videoUrl]);
      setCurrentVideoUrl(videoUrl);
      const session = await geminiService.startChatSession();
      setChatSession(session);
      setChatHistory([{ role: 'model', text: 'Hello! What should I do next?' }]);
    } catch (error) {
        console.error("Error processing local video:", error);
        handleApiError(new Error("There was a problem processing your video file."));
    } finally {
      setIsGeneratingInitialVideo(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!chatSession || !uploadedImage) return;
    setErrorMessage(null);
    setIsChatting(true);
    setIsGeneratingActionVideo(true);
    setActionAudioData(null); // Clear previous audio
    
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', text: message }];
    setChatHistory(newHistory);

    try {
      // Get chat response first so it appears in the UI quickly
      const chatResponse = await geminiService.sendMessage(chatSession, message);
      setChatHistory([...newHistory, { role: 'model', text: chatResponse }]);
      setIsChatting(false);

      // Now generate video and audio in parallel
      const videoResponsePromise = geminiService.generateActionVideo(uploadedImage, message);
      const speechPromise = geminiService.generateSpeech(chatResponse);

      const [videoUrl, audioData] = await Promise.all([videoResponsePromise, speechPromise]);
      
      setCurrentVideoUrl(videoUrl);
      setActionAudioData(audioData);
      setIsGeneratingActionVideo(false);

    } catch (error) {
      handleApiError(error);
    }
  };

  const isActionVideoPlaying = initialVideoUrls !== null && currentVideoUrl !== null && !initialVideoUrls.includes(currentVideoUrl);

  const handleVideoEnd = () => {
    // When an action video finishes, revert to the initial looping video.
    // The initial video will loop on its own via the <video> loop attribute.
    if (isActionVideoPlaying && initialVideoUrls) {
      setCurrentVideoUrl(initialVideoUrls[0]);
    }
  };

  const handleActionAudioEnd = () => {
    // When audio ends, clear the data so it doesn't replay
    setActionAudioData(null);
  };

  const isBusy = isGeneratingActionVideo || isChatting || isGeneratingInitialVideo || isActionVideoPlaying;

  const renderContent = () => {
    if (!apiKeySelected) {
      return <ApiKeySelector onApiKeySelected={handleApiKeySelected} errorMessage={errorMessage} />;
    }
    
    if (isGeneratingInitialVideo) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <p className="text-2xl animate-pulse">Loading character...</p>
          <p className="mt-4 text-gray-400">This can take a few minutes for a new character. Previously used characters will load much faster!</p>
        </div>
      );
    }

    if (initialVideoUrls) {
      return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
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

    return (
      <ImageUploader 
        onImageUpload={handleImageUpload}
        onGenerate={handleGenerateInitialVideo}
        onSelectLocalVideo={handleSelectLocalVideo}
        imagePreview={uploadedImage?.base64 ? `data:${uploadedImage.mimeType};base64,${uploadedImage.base64}` : null}
        isUploading={isBusy}
      />
    );
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
      <AudioPlayer src={actionAudioData} onEnded={handleActionAudioEnd} />
    </div>
  );
};

export default App;