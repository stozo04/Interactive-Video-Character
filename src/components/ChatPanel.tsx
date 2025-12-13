import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import LoadingSpinner from './LoadingSpinner';
import TypingIndicator from './TypingIndicator';

interface ChatPanelProps {
  history: ChatMessage[];
  onSendMessage: (message: string) => void;
  onSendImage?: (base64: string, mimeType: string) => void;
  onOpenWhiteboard?: () => void;
  onUserActivity?: () => void;
  isSending: boolean;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ 
  history, 
  onSendMessage, 
  onSendImage,
  onOpenWhiteboard,
  onUserActivity,
  isSending 
}) => {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // STT (Browser Speech Recognition)
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Force re-render when STT support is detected
  const [hasRecognition, setHasRecognition] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [history]);

  // Auto-resize textarea based on content
  const autoResizeTextarea = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  };

  useEffect(() => {
    autoResizeTextarea();
  }, [input]);

  const textBeforeRef = useRef('');

  // Initialize STT
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        // Reconstruct the full transcript from the current session
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        // Append to text that existed before recording started
        const currentSessionText = finalTranscript + interimTranscript;
        setInput(textBeforeRef.current + (textBeforeRef.current ? ' ' : '') + currentSessionText);
      };

      recognition.onend = () => {
          // Only reset UI state, don't clear input
          setIsListening(false);
      };
      
      recognitionRef.current = recognition;
      setHasRecognition(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isSending) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    onUserActivity?.();
    const file = e.target.files?.[0];
    if (!file || !onSendImage) return;
  
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      onSendImage(base64, file.type);
    };
    // Reset input value
    e.target.value = '';
  };

  // --- Microphone Logic ---

  const toggleListening = async () => {
    onUserActivity?.();
    if (isSending) return;

    if (isListening) {
      // Stop
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
        
        // REMOVED AUTO-SEND
        // The text remains in the input box.
        // The user must click the "Send" arrow manually.
      }
    } else {
      // Start
      if (recognitionRef.current) {
        try {
          textBeforeRef.current = input; // Save existing text
          recognitionRef.current.start();
          setIsListening(true);
          console.log("🎤 Listening...");
        } catch (e) {
          console.error("STT Error:", e);
        }
      }
    }
  };

  const isMicSupported = !!recognitionRef.current || hasRecognition;
  const micLabel = isListening ? "Click to Send" : "Click to Speak";
  const emojiOptions = ['😀','😁','😊','😉','😍','🤔','😅','😭','☹️','😴','🤗','😬','🔥','✨','🎉','💪','👍','👎','🙏','❤️'];

  const handleEmojiSelect = (emoji: string) => {
    setInput(prev => `${prev}${emoji}`);
    setIsEmojiOpen(false);
    onUserActivity?.();
  };

  return (
    <div className="bg-gray-800/70 h-full flex flex-col rounded-lg p-4 border border-gray-700 shadow-lg">
      <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-4 mb-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4B5563 #1F2937' }}>
        {history.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs md:max-w-md lg:max-w-sm xl:max-w-md px-4 py-2 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
              {/* User-sent images */}
              {msg.image && (
                 <img 
                   src={`data:image/jpeg;base64,${msg.image}`} 
                   alt="Uploaded content" 
                   className="max-w-full rounded-lg mb-2 border border-white/20"
                 />
              )}
              {/* AI-generated selfie images */}
              {msg.assistantImage && (
                <div className="mb-2">
                  <img 
                    src={`data:${msg.assistantImageMimeType || 'image/png'};base64,${msg.assistantImage}`} 
                    alt="selfie" 
                    className="max-w-full rounded-lg border border-pink-400/30 shadow-lg shadow-pink-500/20"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                  />
                  <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-pink-400 rounded-full animate-pulse"></span>
                  </div>
                </div>
              )}
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
        {isSending && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex-shrink-0 flex items-center gap-2 border-t border-gray-700 pt-4 relative">
        {/* Image Upload Button */}
        {onSendImage && (
            <>
                <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending}
                    className="p-3 rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
                    title="Send Image"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </button>
            </>
        )}

        {/* Whiteboard Button */}
        {onOpenWhiteboard && (
          <button
            type="button"
            onClick={() => {
              onUserActivity?.();
              onOpenWhiteboard();
            }}
            disabled={isSending}
            className="p-3 rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="Open Whiteboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            onUserActivity?.();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() && !isSending) {
                onSendMessage(input.trim());
                setInput('');
              }
            }
            // Shift+Enter allows default behavior (new line)
          }}
          placeholder={
            isSending ? "Processing..." : 
            isListening ? "Listening..." : 
            'Type a message...'
          }
          disabled={isSending || isListening}
          rows={1}
          className="flex-grow bg-gray-700 rounded-2xl py-2 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-none overflow-hidden"
          style={{ minHeight: '40px', maxHeight: '120px' }}
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              onUserActivity?.();
              setIsEmojiOpen(prev => !prev);
            }}
            disabled={isSending}
            className="p-3 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="Insert emoji"
            aria-haspopup="true"
            aria-expanded={isEmojiOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm-2.5-8a1 1 0 112 0 1 1 0 01-2 0zm5 0a1 1 0 112 0 1 1 0 01-2 0zm-5.598 3.8a.75.75 0 011.196-.9A3.49 3.49 0 0010 14.5c1.05 0 1.99-.46 2.902-1.6a.75.75 0 111.196.9A4.99 4.99 0 0110 16c-1.674 0-3.103-.83-4.098-2.2z" />
            </svg>
          </button>
          {isEmojiOpen && (
            <div className="absolute right-0 bottom-14 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-3 grid grid-cols-5 gap-2 z-20 min-w-[220px] max-w-[260px]">
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleEmojiSelect(emoji)}
                  className="h-10 w-10 text-2xl hover:bg-gray-700 rounded-lg flex items-center justify-center leading-none"
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        {isMicSupported && (
           <button
             type="button"
             onClick={toggleListening}
             disabled={isSending}
             title={micLabel}
             className={`p-3 rounded-full text-white transition-colors ${
                isListening 
                ? 'bg-red-600 animate-pulse' 
                : 'bg-indigo-600 hover:bg-indigo-500'
             } disabled:bg-gray-600 disabled:cursor-not-allowed`}
            aria-label={micLabel}
           >
              {isListening ? (
                // Stop Icon
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
              ) : (
                // Mic Icon
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm-1 3a4 4 0 00-4 4v1a1 1 0 001 1h10a1 1 0 001-1v-1a4 4 0 00-4-4V7zM14 11v-1a2 2 0 10-4 0v1a2 2 0 104 0z" clipRule="evenodd" />
                </svg>
              )}
           </button>
        )}
        <button
          type="submit"
          disabled={isSending || !input.trim() || isListening}
          className="bg-indigo-600 rounded-full p-3 text-white hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {isSending ? (
            <LoadingSpinner size="h-5 w-5" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
};

export default ChatPanel;
