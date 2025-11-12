import React, { useState } from 'react';

interface ApiKeySelectorProps {
  onApiKeySelected: () => void;
  errorMessage?: string | null;
  isAiStudio: boolean;
}

const ApiKeySelector: React.FC<ApiKeySelectorProps> = ({ onApiKeySelected, errorMessage, isAiStudio }) => {
  const [localApiKey, setLocalApiKey] = useState('');

  const handleSelectKey = async () => {
    try {
      if (window.aistudio) {
        await window.aistudio.openSelectKey();
        onApiKeySelected();
      }
    } catch (error) {
      console.error("Error opening API key selector:", error);
    }
  };

  const handleSaveLocalKey = () => {
    if (localApiKey.trim()) {
      // Mock process.env for local development
      if (!window.process) {
        window.process = { env: {} };
      }
      window.process.env.API_KEY = localApiKey.trim();
      onApiKeySelected();
    }
  };
  
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSaveLocalKey();
  };

  if (isAiStudio) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center bg-gray-800 p-8 rounded-lg">
        <h2 className="text-2xl font-bold mb-4">API Key Required</h2>
        <p className="text-gray-400 mb-6 max-w-md">
          This application uses Gemini models that require you to select your own API key. Your key is stored securely and used only for your session.
        </p>
        {errorMessage && <p className="text-red-400 mb-4">{errorMessage}</p>}
        <button
          onClick={handleSelectKey}
          className="bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-500 transition-colors duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          Select API Key
        </button>
        <a 
          href="https://ai.google.dev/gemini-api/docs/billing" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-sm text-gray-500 mt-4 hover:text-indigo-400 underline"
        >
          Learn more about billing
        </a>
      </div>
    );
  }

  // Local development UI
  return (
    <div className="flex flex-col items-center justify-center h-full text-center bg-gray-800 p-8 rounded-lg">
      <h2 className="text-2xl font-bold mb-4">Enter API Key</h2>
      <p className="text-gray-400 mb-6 max-w-md">
        You seem to be running this app locally. Please enter your Gemini API key to continue.
      </p>
      {errorMessage && <p className="text-red-400 mb-4">{errorMessage}</p>}
      <form onSubmit={handleFormSubmit} className="flex w-full max-w-sm gap-2">
        <input
          type="password"
          value={localApiKey}
          onChange={(e) => setLocalApiKey(e.target.value)}
          placeholder="Enter your Gemini API Key"
          className="flex-grow bg-gray-700 rounded-lg py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Gemini API Key"
        />
        <button
          type="submit"
          disabled={!localApiKey.trim()}
          className="bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-500 transition-colors duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </form>
       <a 
        href="https://aistudio.google.com/app/apikey" 
        target="_blank" 
        rel="noopener noreferrer" 
        className="text-sm text-gray-500 mt-4 hover:text-indigo-400 underline"
      >
        Get an API Key from Google AI Studio
      </a>
    </div>
  );
};

export default ApiKeySelector;
