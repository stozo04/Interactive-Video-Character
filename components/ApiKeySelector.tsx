
import React from 'react';

interface ApiKeySelectorProps {
  onApiKeySelected: () => void;
  errorMessage?: string | null;
}

const ApiKeySelector: React.FC<ApiKeySelectorProps> = ({ onApiKeySelected, errorMessage }) => {
  const handleSelectKey = async () => {
    try {
      await window.aistudio.openSelectKey();
      onApiKeySelected();
    } catch (error) {
      console.error("Error opening API key selector:", error);
    }
  };

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
};

export default ApiKeySelector;
