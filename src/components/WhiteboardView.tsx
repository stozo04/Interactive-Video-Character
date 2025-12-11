import React, { useState, useCallback, useRef, useEffect } from 'react';
import Whiteboard, { WhiteboardMode, WhiteboardHandle } from './Whiteboard';
import {
  WHITEBOARD_MODES,
  WhiteboardModeConfig,
  GameState,
  createInitialGameState,
  applyUserMove,
  applyAiMove,
  buildWhiteboardPrompt,
  parseWhiteboardAction,
  WhiteboardAction,
} from '../services/whiteboardModes';

// ============================================================================
// TYPES
// ============================================================================

interface WhiteboardViewProps {
  onSendToAI: (base64: string, message: string, modeContext: string) => Promise<{
    textResponse: string;
    whiteboardAction?: WhiteboardAction | null;
  }>;
  onClose?: () => void;
  disabled?: boolean;
}

// ============================================================================
// WHITEBOARD VIEW COMPONENT
// ============================================================================

export const WhiteboardView: React.FC<WhiteboardViewProps> = ({
  onSendToAI,
  onClose,
  disabled = false,
}) => {
  // State
  const [currentMode, setCurrentMode] = useState<WhiteboardMode>('freeform');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [aiDrawingAction, setAiDrawingAction] = useState<WhiteboardAction | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const [textInput, setTextInput] = useState('');
  const whiteboardRef = useRef<WhiteboardHandle>(null);
  
  // Resize Logic
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);
  
  const handleResize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX;
      setSidebarWidth(Math.max(250, Math.min(newWidth, 800)));
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, handleResize, stopResizing]);

  // ============================================================================
  // MODE SWITCHING
  // ============================================================================

  const handleModeChange = (modeId: string) => {
    setCurrentMode(modeId as WhiteboardMode);
    setChatMessages([]);
    
    if (modeId === 'tictactoe') {
      setGameState(createInitialGameState());
      setChatMessages([{ 
        role: 'ai', 
        text: "Let's play Tic-Tac-Toe! You're X, I'm O. Draw your X anywhere on the grid, then click 'Send to AI' when ready! 🎮" 
      }]);
    } else if (modeId === 'pictionary') {
      setGameState(null);
      setChatMessages([{ 
        role: 'ai', 
        text: "Pictionary time! Draw something and I'll try to guess what it is! 🎨" 
      }]);
    } else {
      setGameState(null);
      setChatMessages([{ 
        role: 'ai', 
        text: "Free drawing mode! Draw anything and I'll tell you what I see! ✏️" 
      }]);
    }
  };

  // ============================================================================
  // AI INTERACTION
  // ============================================================================

  const handleCapture = useCallback(async (base64: string, defaultMessage?: string) => {
    if (disabled || isAiThinking) return;

    setIsAiThinking(true);
    
    const modeConfig = WHITEBOARD_MODES[currentMode];
    const userMessage = defaultMessage || modeConfig.defaultUserMessage;
    const modeContext = buildWhiteboardPrompt(modeConfig, userMessage, gameState || undefined);

    // Add user message to chat
    setChatMessages(prev => [...prev, { role: 'user', text: userMessage }]);

    try {
      const result = await onSendToAI(base64, userMessage, modeContext);
      
      // Add AI response to chat
      setChatMessages(prev => [...prev, { role: 'ai', text: result.textResponse }]);

      // Handle AI Actions (Game Moves or Drawing)
      if (result.whiteboardAction) {
          let currentState = gameState;

          // If AI detected a user move, apply it first
          if (currentMode === 'tictactoe' && currentState && 
              typeof result.whiteboardAction.userMove === 'number') {
              const userMove = result.whiteboardAction.userMove;
              console.log(`🤖 [Tic-Tac-Toe] AI detected user move at: ${userMove}`);
              currentState = applyUserMove(currentState, userMove);
              setGameState(currentState);
          }

          // Then apply AI move
          if (result.whiteboardAction.type === 'mark_cell' && typeof result.whiteboardAction.position === 'number') {
             if (currentMode === 'tictactoe' && currentState) {
                const aiMove = result.whiteboardAction.position;
                const newState = applyAiMove(currentState, aiMove);
                setGameState(newState);

                // USE THE ACTUAL MOVE FROM GAME STATE (in case AI picked an invalid spot and it was randomized)
                const actualAiMove = newState.moveHistory[newState.moveHistory.length - 1];
                let actionToDraw = result.whiteboardAction;

                if (actualAiMove !== undefined && actualAiMove !== aiMove) {
                    console.log(`🤖 [Tic-Tac-Toe] AI tried move ${aiMove}, logic corrected to ${actualAiMove}`);
                    actionToDraw = { ...result.whiteboardAction, position: actualAiMove };
                }

                // Check for game end
                if (newState.status !== 'playing') {
                    let endMessage = '';
                    if (newState.status === 'ai_win') endMessage = "I win! 🎉 Want to play again?";
                    else if (newState.status === 'user_win') endMessage = "You win! 🏆 Great game!";
                    else if (newState.status === 'draw') endMessage = "It's a draw! 🤝 Good game!";
                    
                    if (endMessage) {
                        setTimeout(() => {
                            setChatMessages(prev => [...prev, { role: 'ai', text: endMessage }]);
                        }, 1000);
                    }
                }
                
                // Trigger drawing animation with corrected move
                setAiDrawingAction(actionToDraw);
             }
          } else {
             // For non-game actions, just draw
             setAiDrawingAction(result.whiteboardAction);
          }
      }
    } catch (error) {
      console.error('Error sending to AI:', error);
      setChatMessages(prev => [...prev, { 
        role: 'ai', 
        text: "Oops! I had trouble seeing your drawing. Can you try again?" 
      }]);
    } finally {
      setIsAiThinking(false);
    }
  }, [currentMode, gameState, disabled, isAiThinking, onSendToAI]);

  const handleAiDrawingComplete = useCallback(() => {
    setAiDrawingAction(null);
  }, []);

  // ============================================================================
  // GAME CONTROLS
  // ============================================================================

  const handleNewGame = () => {
    if (currentMode === 'tictactoe') {
      setGameState(createInitialGameState());
      setChatMessages([{ 
        role: 'ai', 
        text: "New game! You're X, I'm O. Your move! 🎮" 
      }]);
    }
  };

  const handleSendMessage = () => {
    if (!textInput.trim() && !gameState) return;
    
    const base64 = whiteboardRef.current?.capture();
    if (base64) {
        handleCapture(base64, textInput.trim());
        setTextInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-white">🎨 Whiteboard</h2>
          
          {/* Mode Selector */}
          <div className="flex gap-1 bg-gray-700 rounded-lg p-1">
            {Object.values(WHITEBOARD_MODES).map((mode: WhiteboardModeConfig) => (
              <button
                key={mode.id}
                onClick={() => handleModeChange(mode.id)}
                className={`
                  px-3 py-1.5 rounded-md text-sm transition-all
                  ${currentMode === mode.id 
                    ? 'bg-indigo-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-600'
                  }
                `}
              >
                {mode.icon} {mode.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {currentMode === 'tictactoe' && gameState?.status !== 'playing' && (
            <button
              onClick={handleNewGame}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium"
            >
              🔄 New Game
            </button>
          )}
          
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Whiteboard */}
        <div className="flex-1 flex flex-col">
          <Whiteboard
            ref={whiteboardRef}
            mode={currentMode}
            onCapture={handleCapture}
            disabled={disabled || isAiThinking}
            aiDrawingAction={aiDrawingAction}
            onAiDrawingComplete={handleAiDrawingComplete}
          />
        </div>

        {/* Resize Handle */}
        <div
            className={`w-1 cursor-col-resize hover:bg-blue-500 transition-colors ${isResizing ? 'bg-blue-500' : 'bg-gray-700'}`}
            onMouseDown={startResizing}
        />

        {/* Chat Sidebar */}
        <div 
            style={{ width: sidebarWidth }}
            className="flex flex-col bg-gray-800 border-l border-gray-700 flex-shrink-0"
        >
          <div className="px-4 py-2 border-b border-gray-700">
            <h3 className="text-sm font-medium text-gray-300">Game Chat</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`
                  p-3 rounded-lg text-sm
                  ${msg.role === 'user' 
                    ? 'bg-indigo-600 ml-8' 
                    : 'bg-gray-700 mr-8'
                  }
                `}
              >
                {msg.text}
              </div>
            ))}
            
            {isAiThinking && (
              <div className="bg-gray-700 mr-8 p-3 rounded-lg text-sm text-gray-400">
                <span className="animate-pulse">🤔 Thinking...</span>
              </div>
            )}
          </div>

          {/* Game Status (for Tic-Tac-Toe) */}
          {currentMode === 'tictactoe' && gameState && (
            <div className="p-3 border-t border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Game Status</div>
              <div className="text-sm">
                {gameState.status === 'playing' && (
                  <span className={gameState.currentTurn === 'user' ? 'text-green-400' : 'text-yellow-400'}>
                    {gameState.currentTurn === 'user' ? "Your turn (X)" : "AI's turn (O)"}
                  </span>
                )}
                {gameState.status === 'user_win' && <span className="text-green-400">You won! 🏆</span>}
                {gameState.status === 'ai_win' && <span className="text-red-400">AI won! 🤖</span>}
                {gameState.status === 'draw' && <span className="text-yellow-400">Draw! 🤝</span>}
              </div>
            </div>
          )}

          {/* Chat Input */}
          <div className="p-3 border-t border-gray-700 bg-gray-800">
            <div className="flex gap-2">
                <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                    disabled={disabled || isAiThinking}
                />
                <button
                    onClick={handleSendMessage}
                    disabled={disabled || isAiThinking || !textInput.trim()}
                    className="p-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    📤
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WhiteboardView;
