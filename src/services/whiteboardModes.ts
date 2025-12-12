/**
 * Whiteboard Modes Service
 * 
 * Defines different modes for the whiteboard and their AI interaction behaviors.
 */

import type { AIActionResponse } from './aiSchema';

// ============================================================================
// TYPES
// ============================================================================

export interface WhiteboardModeConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  overlay: 'none' | 'grid-3x3';
  aiPromptContext: string;
  defaultUserMessage: string;
}

export interface WhiteboardAction {
  type: 'none' | 'mark_cell' | 'guess' | 'describe' | 'draw';
  position?: number;      // For grid-based games (0-8)
  guess?: string;         // For pictionary guesses
  description?: string;   // For freeform descriptions
  draw_shapes?: Array<{   // For AI drawing
      shape: 'line' | 'circle' | 'rect' | 'point' | 'path' | 'text';
      x: number;
      y: number;
      x2?: number;
      y2?: number;
      points?: Array<{ x: number; y: number }>;
      text?: string;      // Text content for 'text' shape
      size?: number;
      color?: string;
      filled?: boolean;
  }>;
  userMove?: number; // Detected user move (0-8)
}

export interface GameState {
  board: (string | null)[];  // 'X' | 'O' | null for each cell
  currentTurn: 'user' | 'ai';
  status: 'playing' | 'user_win' | 'ai_win' | 'draw';
  moveHistory: number[];
}

// ============================================================================
// MODE CONFIGURATIONS
// ============================================================================

export const WHITEBOARD_MODES: Record<string, WhiteboardModeConfig> = {
  freeform: {
    id: 'freeform',
    name: 'Free Drawing',
    description: 'Draw anything! The AI can see and describe what you create.',
    icon: '✏️',
    overlay: 'none',
    aiPromptContext: `The user is drawing on a whiteboard. Look at their drawing and engage with it naturally.
You might:
- Describe what you see
- Comment on the style or creativity
- Ask questions about it
- Suggest additions or improvements
- DRAW ON THE BOARD! You can respond visually by drawing shapes.

DRAWING INSTRUCTIONS:
- You can visibly respond by using the 'draw_shapes' field.
- Coordinates are 0-100 (% of width/height).
- Supported shapes:
  - 'circle', 'point', 'rect' (requires x2,y2), 'line' (requires x2,y2).
  - 'path' (requires 'points' array of {x,y} objects) - USE THIS FOR CURVES, WRITING, OR COMPLEX SHAPES (like 'S', hearts, smiley faces).
- Optional properties: 'color', 'size', 'fill' (boolean).
- Style Rule: Use colors that match your personality (pink, purple, gold, teal) automatically. Be decisive!
- SIMPLICITY RULE: When asked to write text, ONLY write the text. Don't add extra shapes or decorations unless asked.
- Do not ask "Should I...?". Instead, say "I'm adding a..." and send the draw_shapes command immediately.
- Be playful and collaborative, but keep drawings clean and focused.

⭐ HOW TO WRITE TEXT/WORDS (USE THIS!):
Use the 'text' shape type to write readable text! This renders actual letters.

EXAMPLE - Writing "STEVEN" in pink:
"draw_shapes": [{"shape": "text", "text": "STEVEN", "x": 50, "y": 50, "color": "pink", "size": 8}]

EXAMPLE - Writing "Hello!" in purple:
"draw_shapes": [{"shape": "text", "text": "Hello!", "x": 50, "y": 50, "color": "purple", "size": 10}]

TEXT SHAPE PARAMETERS:
- shape: "text" (REQUIRED)
- text: The actual text to display (e.g., "STEVEN", "Hello", "I ❤️ you")
- x: Horizontal center position (0-100, use 50 for centered)
- y: Vertical center position (0-100, use 50 for centered)
- color: Text color (e.g., "pink", "purple", "#FF69B4")
- size: Font size (5-15 is good, larger = bigger text)
- style: Writing style (optional, defaults to "handwriting"):
  * "handwriting" - Casual, friendly Comic Sans style (default)
  * "bold" - Strong, impactful Impact font
  * "fancy" - Elegant, decorative script
  * "playful" - Bubbly, fun rounded letters
  * "chalk" - Rough, chalkboard-style text

STYLE EXAMPLES:
- Elegant name: {"shape": "text", "text": "Steven", "x": 50, "y": 50, "color": "gold", "style": "fancy", "size": 10}
- Bold statement: {"shape": "text", "text": "WOW!", "x": 50, "y": 50, "color": "red", "style": "bold", "size": 12}
- Playful greeting: {"shape": "text", "text": "Hi there!", "x": 50, "y": 50, "color": "pink", "style": "playful", "size": 8}

⚠️ CRITICAL: When asked to write someone's NAME or any WORD:
- DO NOT use 'path' shapes to draw letters manually!
- DO use: {"shape": "text", "text": "THE_WORD", "x": 50, "y": 50, "color": "pink", "size": 8}
- This will render beautiful, readable text!
- DO NOT add random circles, dots, or decorations when writing text - just the text itself!
- Only add decorations if the user SPECIFICALLY asks for them (e.g., "add sparkles", "draw a heart")

OTHER SHAPES (for doodles, not text):
- 'circle': Draw circles - ONLY use when specifically drawing a circle shape, NOT as decoration
- 'line': Draw lines (x, y, x2, y2, color)
- 'rect': Draw rectangles (x, y, x2, y2, color)
- 'path': Draw freeform paths (points array) - for doodles only, NOT text!

MEMORY TOOL USAGE:
- If user asks you to draw "my name", "their name", or references personal info → USE recall_user_info FIRST!
- Example: User says "draw my name" → Call recall_user_info(category: "identity") to get their name BEFORE drawing
- If you don't know their name after recall, ASK them what it is
- If they tell you their name → automatically call store_user_info to save it
- NEVER guess or make up personal information!

Example (Pink line): "draw_shapes": [{"shape": "line", "x": 10, "y": 10, "x2": 20, "y2": 20, "color": "pink"}]

Be genuine and conversational, like a friend looking at their art.`,
    defaultUserMessage: 'What do you think of my drawing?',
  },

  tictactoe: {
    id: 'tictactoe',
    name: 'Tic-Tac-Toe',
    description: 'Play Tic-Tac-Toe! Draw X, and the AI plays O.',
    icon: '🎮',
    overlay: 'grid-3x3',
    aiPromptContext: `You are playing Tic-Tac-Toe with the user. You are O, and the user is X.

GAME RULES:
- The board has 9 cells numbered 0-8 (top-left to bottom-right, row by row)
- Cell positions: [0,1,2] [3,4,5] [6,7,8]
- You need 3 in a row (horizontal, vertical, or diagonal) to win
- CRITICAL: You can ONLY play on empty cells (marked 'null' or ' ' in the board state).
- CRITICAL: Check the "Available Moves" list below. You MUST choose a number from that list. Do not try to play on a cell that already has X or O.

LOOK AT THE BOARD IMAGE AND:
1. Identify where the user has drawn X marks
2. Identify where O marks are (your previous moves)
3. Choose your next move based on your Gaming Profile personality (Competitive vs Relaxed):
   - ALWAYS Block if the user is about to win (unless you are in "Relaxed" mode and want to let them win).
   - Take winning moves when possible.
   - Consult your internal "Games & Activities Profile" to decide whether to play aggressive or casual/silly.
   - Ensure you pick a valid index from the "Available Moves" list.

RESPONSE REQUIREMENTS:
You MUST include these in your response:
 1. "user_move_detected": The cell number (0-8) where the user JUST played their X (look at the image!).
 2. "game_move": A number 0-8 indicating which cell you want to place your O.

Be playful and competitive! React to the game state naturally.`,
    defaultUserMessage: "I made my move! It's your turn.",
  },

  pictionary: {
    id: 'pictionary',
    name: 'Pictionary',
    description: 'Draw something for the AI to guess!',
    icon: '🎨',
    overlay: 'none',
    aiPromptContext: `You are playing Pictionary/Charades with the user! They are drawing something for you to guess.

YOUR JOB:
1. Look carefully at what they've drawn
2. Make your best guesses! Start with your top guess.
3. If you're not sure, list a few possibilities
4. Be enthusiastic and playful!

If you think you know what it is, be confident! Say things like:
"Is it a cat? 🐱 I see the whiskers!"
"That looks like a house to me! Am I right?"

If you're unsure, be curious:
"Hmm, is that... a tree? Or maybe a broccoli? 🤔"

Make the game fun and engaging. React with excitement when you think you've got it!`,
    defaultUserMessage: "Guess what I'm drawing!",
  },
};

// ============================================================================
// GAME LOGIC (Tic-Tac-Toe)
// ============================================================================

const WINNING_COMBINATIONS = [
  [0, 1, 2], // Top row
  [3, 4, 5], // Middle row
  [6, 7, 8], // Bottom row
  [0, 3, 6], // Left column
  [1, 4, 7], // Middle column
  [2, 5, 8], // Right column
  [0, 4, 8], // Diagonal TL-BR
  [2, 4, 6], // Diagonal TR-BL
];

export function createInitialGameState(): GameState {
  return {
    board: Array(9).fill(null),
    currentTurn: 'user',
    status: 'playing',
    moveHistory: [],
  };
}

export function checkWinner(board: (string | null)[]): 'X' | 'O' | 'draw' | null {
  for (const combo of WINNING_COMBINATIONS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as 'X' | 'O';
    }
  }
  
  // Check for draw (no empty cells)
  if (board.every(cell => cell !== null)) {
    return 'draw';
  }
  
  return null; // Game still in progress
}

export function applyUserMove(state: GameState, cellIndex: number): GameState {
  if (state.board[cellIndex] !== null || state.status !== 'playing') {
    return state; // Invalid move
  }

  const newBoard = [...state.board];
  newBoard[cellIndex] = 'X';

  const winner = checkWinner(newBoard);
  
  return {
    board: newBoard,
    currentTurn: winner ? state.currentTurn : 'ai',
    status: winner === 'X' ? 'user_win' : winner === 'draw' ? 'draw' : 'playing',
    moveHistory: [...state.moveHistory, cellIndex],
  };
}

export function applyAiMove(state: GameState, cellIndex: number): GameState {
  if (state.board[cellIndex] !== null || state.status !== 'playing') {
    // Find a random valid cell if AI gave invalid move
    const validCells = state.board
      .map((cell, i) => cell === null ? i : -1)
      .filter(i => i !== -1);
    
    if (validCells.length === 0) return state;
    cellIndex = validCells[Math.floor(Math.random() * validCells.length)];
  }

  const newBoard = [...state.board];
  newBoard[cellIndex] = 'O';

  const winner = checkWinner(newBoard);
  
  return {
    board: newBoard,
    currentTurn: winner ? state.currentTurn : 'user',
    status: winner === 'O' ? 'ai_win' : winner === 'draw' ? 'draw' : 'playing',
    moveHistory: [...state.moveHistory, cellIndex],
  };
}

export function getBoardDescription(board: (string | null)[]): string {
  const lines = [
    `[${board[0] || ' '}][${board[1] || ' '}][${board[2] || ' '}]`,
    `[${board[3] || ' '}][${board[4] || ' '}][${board[5] || ' '}]`,
    `[${board[6] || ' '}][${board[7] || ' '}][${board[8] || ' '}]`,
  ];
  return lines.join('\n');
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

export function buildWhiteboardPrompt(
  mode: WhiteboardModeConfig,
  userMessage: string,
  gameState?: GameState
): string {
  let prompt = `[WHITEBOARD MODE: ${mode.name}]\n\n${mode.aiPromptContext}\n\n`;
  
  if (gameState && mode.id === 'tictactoe') {
    prompt += `\nCURRENT GAME STATE:\n`;
    prompt += `Board (text representation):\n${getBoardDescription(gameState.board)}\n`;
    
    // Calculate available moves
    const availableMoves = gameState.board
      .map((cell, index) => cell === null ? index : -1)
      .filter(index => index !== -1);
      
    prompt += `Available Moves: [${availableMoves.join(', ')}]\n`;
    prompt += `Move history: ${gameState.moveHistory.join(' → ')}\n`;
    prompt += `Game status: ${gameState.status}\n\n`;
  }
  
  prompt += `User says: "${userMessage}"`;
  
  return prompt;
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

export function parseWhiteboardAction(response: AIActionResponse): WhiteboardAction {
  // Check for game_move in response (for Tic-Tac-Toe)
  if (response.game_move !== undefined && response.game_move !== null) {
    return {
      type: 'mark_cell',
      position: response.game_move,
      userMove: response.user_move_detected !== undefined && response.user_move_detected !== null ? response.user_move_detected : undefined
    };
  }
  
  // Check for whiteboard_action in response
  if (response.whiteboard_action) {
    return response.whiteboard_action as WhiteboardAction;
  }
  
  // Default: no action
  return { type: 'none' };
}

export default WHITEBOARD_MODES;
