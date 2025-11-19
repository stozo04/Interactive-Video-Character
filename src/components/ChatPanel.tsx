
import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import TypingIndicator from './TypingIndicator';

interface ChatPanelProps {
  history: ChatMessage[];
  onSendMessage: (message: string) => void;
  isSending: boolean;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ history, onSendMessage, isSending }) => {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [history]);

  useEffect(() => {
    // Check for browser support and initialize SpeechRecognition
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true; // Show results as they are recognized
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        setInput(finalTranscript || interimTranscript);
      };
      
      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isSending) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleMicPress = () => {
    if (isSending || !recognitionRef.current) return;

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.error("Could not start recognition:", e);
      // This can happen if permission is denied or already active.
    }
  };

  const handleMicRelease = () => {
    if (!isListening || !recognitionRef.current) return;
    
    recognitionRef.current.stop();
    setIsListening(false);
    
    // Use a small timeout to allow the final transcript to be processed
    setTimeout(() => {
      // Access the state via the ref to get the latest value after recognition ends
      const finalInput = input;
      if (finalInput.trim() && !isSending) {
        onSendMessage(finalInput.trim());
        setInput('');
      }
    }, 100);
  };

  const isMicSupported = !!recognitionRef.current;

  return (
    <div className="bg-gray-800/70 h-full flex flex-col rounded-lg p-4 border border-gray-700 shadow-lg">
      <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-4 mb-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4B5563 #1F2937' }}>
        {history.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs md:max-w-md lg:max-w-sm xl:max-w-md px-4 py-2 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
        {isSending && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex-shrink-0 flex items-center gap-2 border-t border-gray-700 pt-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isSending
              ? "Processing..."
              : isListening
              ? "Listening..."
              : 'Type an action command (e.g., "Wave to the camera")'
          }
          disabled={isSending || isListening}
          className="flex-grow bg-gray-700 rounded-full py-2 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        />
        {isMicSupported && (
           <button
             type="button"
             onMouseDown={handleMicPress}
             onMouseUp={handleMicRelease}
             onTouchStart={handleMicPress}
             onTouchEnd={handleMicRelease}
             disabled={isSending}
             className={`p-3 rounded-full text-white transition-colors ${
                isListening 
                ? 'bg-red-600 animate-pulse' 
                : 'bg-indigo-600 hover:bg-indigo-500'
             } disabled:bg-gray-600 disabled:cursor-not-allowed`}
            aria-label={isListening ? "Stop recording" : "Start recording"}
           >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm-1 3a4 4 0 00-4 4v1a1 1 0 001 1h10a1 1 0 001-1v-1a4 4 0 00-4-4V7zM14 11v-1a2 2 0 10-4 0v1a2 2 0 104 0z" clipRule="evenodd" />
              </svg>
           </button>
        )}
        <button
          type="submit"
          disabled={isSending || !input.trim() || isListening}
          className="bg-indigo-600 rounded-full p-3 text-white hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </button>
      </form>
    </div>
  );
};

export default ChatPanel;