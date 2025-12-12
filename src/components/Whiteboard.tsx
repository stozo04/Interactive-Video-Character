import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { WhiteboardAction } from '../services/whiteboardModes';

// ============================================================================
// TYPES
// ============================================================================

export type DrawingTool = 'pen' | 'highlighter' | 'marker' | 'eraser';
export type WhiteboardMode = 'freeform' | 'tictactoe' | 'pictionary';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  tool: DrawingTool;
  color: string;
  filled?: boolean;
}

type TextStyle = 'handwriting' | 'bold' | 'fancy' | 'playful' | 'chalk';

interface TextElement {
  text: string;
  x: number;  // percentage (0-100)
  y: number;  // percentage (0-100)
  color: string;
  size: number; // percentage (0-100)
  style: TextStyle;
  // Animation state: which character we're on and how much of it is drawn
  currentCharIndex: number;   // Which character is currently being "drawn"
  charDrawProgress: number;   // 0-100, how much of current char is drawn (top to bottom)
  isAnimating: boolean;
}

// Font configurations for different text styles
const TEXT_STYLE_FONTS: Record<TextStyle, string> = {
  handwriting: '"Comic Sans MS", "Marker Felt", cursive',
  bold: '"Impact", "Arial Black", sans-serif',
  fancy: '"Brush Script MT", "Lucida Handwriting", cursive',
  playful: '"Fredoka One", "Bubblegum Sans", "Comic Sans MS", cursive',
  chalk: '"Chalkduster", "Comic Sans MS", cursive'
};


interface ToolConfig {
  name: string;
  icon: string;
  strokeWidth: number;
  opacity: number;
}

const TOOL_CONFIGS: Record<DrawingTool, ToolConfig> = {
  pen: { name: 'Pen', icon: '🖊️', strokeWidth: 3, opacity: 1.0 },
  highlighter: { name: 'Highlighter', icon: '🖍️', strokeWidth: 25, opacity: 0.4 },
  marker: { name: 'Marker', icon: '🖌️', strokeWidth: 10, opacity: 1.0 },
  eraser: { name: 'Eraser', icon: '🧹', strokeWidth: 20, opacity: 1.0 },
};

const DEFAULT_COLORS = [
  '#000000', // Black
  '#FFFFFF', // White
  '#FF3B30', // Red
  '#FF9500', // Orange
  '#FFCC00', // Yellow
  '#34C759', // Green
  '#007AFF', // Blue
  '#AF52DE', // Purple
  '#FF2D55', // Pink
];

// ============================================================================
// WHITEBOARD COMPONENT
// ============================================================================

interface WhiteboardProps {
  mode?: WhiteboardMode;
  onCapture?: (base64: string, message?: string) => void;
  disabled?: boolean;
  aiDrawingAction?: WhiteboardAction | null;
  onAiDrawingComplete?: () => void;
}

export interface WhiteboardHandle {
  capture: () => string | null;
}

export const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(({
  mode = 'freeform',
  onCapture,
  disabled = false,
  aiDrawingAction,
  onAiDrawingComplete,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen');
  const [currentColor, setCurrentColor] = useState('#000000');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  // Undo stack now stores complete canvas state (strokes + text)
  const [undoStack, setUndoStack] = useState<{ strokes: Stroke[]; textElements: TextElement[] }[]>([]);
  const [textElements, setTextElements] = useState<TextElement[]>([]);
  
  // Canvas dimensions
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 400 });

  // ============================================================================
  // CANVAS SETUP & RESIZE
  // ============================================================================

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Leave room for toolbar
        setCanvasSize({
          width: Math.floor(rect.width - 20),
          height: Math.floor(Math.min(rect.height - 80, 500)),
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // ============================================================================
  // DRAWING LOGIC
  // ============================================================================

  const getCanvasCoordinates = useCallback((e: React.MouseEvent | React.TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    e.preventDefault();
    
    const point = getCanvasCoordinates(e);
    if (!point) return;

    setIsDrawing(true);
    setCurrentStroke([point]);
  }, [disabled, getCanvasCoordinates]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return;
    e.preventDefault();

    const point = getCanvasCoordinates(e);
    if (!point) return;

    setCurrentStroke(prev => [...prev, point]);
  }, [isDrawing, disabled, getCanvasCoordinates]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;

    if (currentStroke.length > 0) {
      const newStroke: Stroke = {
        points: currentStroke,
        tool: currentTool,
        color: currentColor,
      };
      
      // Save current state for undo (both strokes and text)
      setUndoStack(prev => [...prev, { strokes, textElements }]);
      setStrokes(prev => [...prev, newStroke]);
    }

    setIsDrawing(false);
    setCurrentStroke([]);
  }, [isDrawing, currentStroke, currentTool, currentColor, strokes]);

  // ============================================================================
  // RENDERING
  // ============================================================================

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid overlay for Tic-Tac-Toe mode
    if (mode === 'tictactoe') {
      ctx.strokeStyle = '#E0E0E0';
      ctx.lineWidth = 3;
      
      const cellWidth = canvas.width / 3;
      const cellHeight = canvas.height / 3;
      
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(cellWidth, 0);
      ctx.lineTo(cellWidth, canvas.height);
      ctx.moveTo(cellWidth * 2, 0);
      ctx.lineTo(cellWidth * 2, canvas.height);
      
      // Horizontal lines
      ctx.moveTo(0, cellHeight);
      ctx.lineTo(canvas.width, cellHeight);
      ctx.moveTo(0, cellHeight * 2);
      ctx.lineTo(canvas.width, cellHeight * 2);
      ctx.stroke();
    }

    // Render all strokes
    const renderStroke = (stroke: Stroke) => {
      if (stroke.points.length < 2) return;

      const config = TOOL_CONFIGS[stroke.tool];
      ctx.globalAlpha = config.opacity;
      ctx.lineWidth = config.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(255,255,255,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      if (stroke.filled) {
          ctx.fillStyle = stroke.color;
          ctx.fill();
      }
    };

    // Render saved strokes
    strokes.forEach(renderStroke);

    // Render current stroke being drawn
    if (currentStroke.length > 1) {
      renderStroke({
        points: currentStroke,
        tool: currentTool,
        color: currentColor,
      });
    }

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Render text elements with character-by-character "drawing" animation
    textElements.forEach(textEl => {
      const x = (textEl.x / 100) * canvas.width;
      const y = (textEl.y / 100) * canvas.height;
      const fontSize = Math.max(24, (textEl.size / 100) * canvas.height * 1.5);
      
      const fontFamily = TEXT_STYLE_FONTS[textEl.style] || TEXT_STYLE_FONTS.handwriting;
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      
      // Calculate the full text width for centering
      const fullTextWidth = ctx.measureText(textEl.text).width;
      const textLeftEdge = x - fullTextWidth / 2;
      
      // Draw each character
      let currentX = textLeftEdge;
      
      for (let i = 0; i < textEl.text.length; i++) {
        const char = textEl.text[i];
        const charWidth = ctx.measureText(char).width;
        
        if (i < textEl.currentCharIndex) {
          // Fully drawn characters - just draw them
          ctx.fillStyle = textEl.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(char, currentX, y);
        } else if (i === textEl.currentCharIndex && textEl.isAnimating) {
          // Currently drawing this character - reveal top to bottom
          ctx.save();
          
          // Clip region that reveals from top to bottom
          const revealHeight = (textEl.charDrawProgress / 100) * fontSize * 2;
          ctx.beginPath();
          ctx.rect(currentX - 2, y - fontSize, charWidth + 4, revealHeight);
          ctx.clip();
          
          ctx.fillStyle = textEl.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(char, currentX, y);
          
          ctx.restore();
          
          // Draw pen tip that oscillates up/down like real handwriting strokes
          // Use sine wave to create natural pen movement within the character
          const strokePhase = (textEl.charDrawProgress / 100) * Math.PI * 3; // Multiple strokes per char
          const baseY = y - fontSize + revealHeight;
          const oscillation = Math.sin(strokePhase) * (fontSize * 0.15); // Subtle up/down movement
          const penY = baseY + oscillation;
          const penX = currentX + (textEl.charDrawProgress / 100) * charWidth; // Move across char too
          
          ctx.fillStyle = textEl.color;
          ctx.beginPath();
          ctx.arc(penX, penY, 4, 0, Math.PI * 2);
          ctx.fill();
          
          // Add a small trail effect
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          ctx.arc(penX - 3, penY - oscillation * 0.5, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        // Characters after currentCharIndex are not drawn yet
        
        currentX += charWidth;
      }
    });
  }, [strokes, currentStroke, currentTool, currentColor, mode, textElements]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // ============================================================================
  // WRITING ANIMATION FOR TEXT ELEMENTS (Character by Character)
  // ============================================================================
  
  useEffect(() => {
    // Check if any text elements are still animating
    const animatingElements = textElements.filter(el => el.isAnimating);
    
    if (animatingElements.length === 0) return;
    
    // Animate each character being "drawn" from top to bottom
    // Speed: each character takes about 400ms to draw (slow, realistic handwriting)
    const animationFrame = setInterval(() => {
      setTextElements(prev => prev.map(el => {
        if (!el.isAnimating) return el;
        
        // Increment the draw progress for current character
        const newCharProgress = el.charDrawProgress + 2.5; // ~40 frames per character (~650ms each)
        
        if (newCharProgress >= 100) {
          // Current character is done, move to next
          const nextCharIndex = el.currentCharIndex + 1;
          
          if (nextCharIndex >= el.text.length) {
            // All characters done!
            return {
              ...el,
              currentCharIndex: el.text.length,
              charDrawProgress: 100,
              isAnimating: false
            };
          } else {
            // Start drawing next character
            return {
              ...el,
              currentCharIndex: nextCharIndex,
              charDrawProgress: 0
            };
          }
        } else {
          // Still drawing current character
          return {
            ...el,
            charDrawProgress: newCharProgress
          };
        }
      }));
    }, 16); // ~60fps
    
    return () => clearInterval(animationFrame);
  }, [textElements]);

  // ============================================================================
  // AI DRAWING (for Tic-Tac-Toe)
  // ============================================================================

  useEffect(() => {
    if (!aiDrawingAction) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const newStrokes: Stroke[] = [];

    // 1. Handle Tic-Tac-Toe Moves
    if (mode === 'tictactoe' && aiDrawingAction.type === 'mark_cell' && typeof aiDrawingAction.position === 'number') {
      const cellWidth = canvas.width / 3;
      const cellHeight = canvas.height / 3;
      const position = aiDrawingAction.position;
      
      const col = position % 3;
      const row = Math.floor(position / 3);
      
      const centerX = col * cellWidth + cellWidth / 2;
      const centerY = row * cellHeight + cellHeight / 2;
      const radius = Math.min(cellWidth, cellHeight) * 0.35;

      const circlePoints: Point[] = [];
      for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
        circlePoints.push({
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }

      newStrokes.push({
        points: circlePoints,
        tool: 'marker',
        color: '#007AFF',
      });
    }

    // 2. Handle Generic Shape Drawing
    let didDrawSomething = false;
    
    if (aiDrawingAction.draw_shapes && aiDrawingAction.draw_shapes.length > 0) {
      aiDrawingAction.draw_shapes.forEach(shapeCmd => {
        const x = (shapeCmd.x / 100) * canvas.width;
        const y = (shapeCmd.y / 100) * canvas.height;
        const color = shapeCmd.color || '#007AFF'; // Default to AI Blue
        
        let points: Point[] = [];

        if (shapeCmd.shape === 'circle') {
          const size = shapeCmd.size ? (shapeCmd.size / 100) * Math.min(canvas.width, canvas.height) : 20;
          for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
            points.push({
              x: x + Math.cos(angle) * size,
              y: y + Math.sin(angle) * size,
            });
          }
        } 
        else if (shapeCmd.shape === 'line' || shapeCmd.shape === 'rect') {
            // Lines and Rects are drawn as straight strokes
            // For rect, we draw 4 lines
            const x2 = shapeCmd.x2 ? (shapeCmd.x2 / 100) * canvas.width : x;
            const y2 = shapeCmd.y2 ? (shapeCmd.y2 / 100) * canvas.height : y;

            if (shapeCmd.shape === 'line') {
                // Generate a hand-drawn style line with wobble
                const dist = Math.sqrt(Math.pow(x2 - x, 2) + Math.pow(y2 - y, 2));
                const segments = Math.max(3, Math.floor(dist / 5)); 
                
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    let px = x + (x2 - x) * t;
                    let py = y + (y2 - y) * t;
                    
                    // Add noise to intermediate points
                    if (i > 0 && i < segments) {
                        const noise = 2.5; // Increased noise for visible wobble
                        px += (Math.random() - 0.5) * noise;
                        py += (Math.random() - 0.5) * noise;
                    }
                    points.push({ x: px, y: py });
                }
            } else {
                // Rect
                points.push({ x, y });
                points.push({ x: x2, y });
                points.push({ x: x2, y: y2 });
                points.push({ x, y: y2 });
                points.push({ x, y }); // Close loop
            }
        }
        else if (shapeCmd.shape === 'path') {
           if (shapeCmd.points && shapeCmd.points.length > 0) {
             shapeCmd.points.forEach(p => {
               points.push({
                 x: (p.x / 100) * canvas.width,
                 y: (p.y / 100) * canvas.height
               });
             });
           }
        }
        else if (shapeCmd.shape === 'point') {
           points.push({ x, y });
           points.push({ x: x + 1, y: y + 1 });
        }
        else if (shapeCmd.shape === 'text' && shapeCmd.text) {
           // Store text element to be rendered in renderCanvas with writing animation
           const style = (shapeCmd.style as TextStyle) || 'handwriting';
           const textEl: TextElement = {
             text: shapeCmd.text,
             x: shapeCmd.x,  // Keep as percentage
             y: shapeCmd.y,  // Keep as percentage
             color: color,
             size: shapeCmd.size || 8,
             style: style,
             currentCharIndex: 0,    // Start at first character
             charDrawProgress: 0,    // Start drawing from top
             isAnimating: true       // Start animating
           };
           setTextElements(prev => [...prev, textEl]);
           console.log(`📝 [Whiteboard] Added text "${shapeCmd.text}" at (${shapeCmd.x}%, ${shapeCmd.y}%) in ${color} with style "${style}" - starting character-by-character animation`);
           didDrawSomething = true;
           return;
        }

        if (points.length > 0) {
            newStrokes.push({
                points,
                tool: 'marker',
                color,
                filled: !!(shapeCmd as any).fill
            });
        }
      });
    }

    if (newStrokes.length > 0 || didDrawSomething) {
        // Save current state for undo (both strokes and text)
        setUndoStack(prev => [...prev, { strokes, textElements }]);
        if (newStrokes.length > 0) {
            setStrokes(prev => [...prev, ...newStrokes]);
        }
        onAiDrawingComplete?.();
    }

  }, [aiDrawingAction, mode, onAiDrawingComplete, strokes]);

  // ============================================================================
  // ACTIONS
  // ============================================================================

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    
    const previousState = undoStack[undoStack.length - 1];
    // Restore both strokes and text elements
    setStrokes(previousState.strokes);
    setTextElements(previousState.textElements);
    setUndoStack(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    // Save current state for undo (both strokes and text)
    setUndoStack(prev => [...prev, { strokes, textElements }]);
    setStrokes([]);
    setTextElements([]);
  };

  const generateImage = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Render without grid for cleaner capture
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    // White background
    tempCtx.fillStyle = '#FFFFFF';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw grid if in tictactoe mode
    if (mode === 'tictactoe') {
      tempCtx.strokeStyle = '#333333';
      tempCtx.lineWidth = 3;
      
      const cellWidth = tempCanvas.width / 3;
      const cellHeight = tempCanvas.height / 3;
      
      tempCtx.beginPath();
      tempCtx.moveTo(cellWidth, 0);
      tempCtx.lineTo(cellWidth, tempCanvas.height);
      tempCtx.moveTo(cellWidth * 2, 0);
      tempCtx.lineTo(cellWidth * 2, tempCanvas.height);
      tempCtx.moveTo(0, cellHeight);
      tempCtx.lineTo(tempCanvas.width, cellHeight);
      tempCtx.moveTo(0, cellHeight * 2);
      tempCtx.lineTo(tempCanvas.width, cellHeight * 2);
      tempCtx.stroke();
    }

    // Copy strokes
    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      
      const config = TOOL_CONFIGS[stroke.tool];
      tempCtx.globalAlpha = config.opacity;
      tempCtx.lineWidth = config.strokeWidth;
      tempCtx.lineCap = 'round';
      tempCtx.lineJoin = 'round';
      tempCtx.strokeStyle = stroke.color;
      
      tempCtx.beginPath();
      tempCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        tempCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      tempCtx.stroke();
      
      // Handle filled shapes (match main canvas rendering)
      if (stroke.filled) {
        tempCtx.fillStyle = stroke.color;
        tempCtx.fill();
      }
    });

    // Copy text elements (show full text, not animated)
    tempCtx.globalAlpha = 1;
    textElements.forEach(textEl => {
      const x = (textEl.x / 100) * tempCanvas.width;
      const y = (textEl.y / 100) * tempCanvas.height;
      const fontSize = Math.max(24, (textEl.size / 100) * tempCanvas.height * 1.5);
      
      const fontFamily = TEXT_STYLE_FONTS[textEl.style] || TEXT_STYLE_FONTS.handwriting;
      tempCtx.font = `bold ${fontSize}px ${fontFamily}`;
      tempCtx.fillStyle = textEl.color;
      tempCtx.textAlign = 'center';
      tempCtx.textBaseline = 'middle';
      // Always show full text in captures (not the animated partial text)
      tempCtx.fillText(textEl.text, x, y);
    });

    return tempCanvas.toDataURL('image/png').split(',')[1];
  }, [mode, strokes, textElements]);

  useImperativeHandle(ref, () => ({
    capture: generateImage,
  }));

  const handleCapture = () => {
    if (!onCapture) return;
    const base64 = generateImage();
    if (!base64) return;
    
    let defaultMessage = '';
    if (mode === 'tictactoe') {
      defaultMessage = "It's your turn! Look at the board and make your move.";
    } else if (mode === 'pictionary') {
      defaultMessage = "What do you think I'm drawing?";
    }
    
    onCapture(base64, defaultMessage);
  };

  // ============================================================================
  // RENDER UI
  // ============================================================================

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-800 border-b border-gray-700">
        {/* Tool Selection */}
        <div className="flex gap-1 bg-gray-700 rounded-lg p-1">
          {(Object.keys(TOOL_CONFIGS) as DrawingTool[]).map((tool) => (
            <button
              key={tool}
              onClick={() => setCurrentTool(tool)}
              className={`
                px-3 py-2 rounded-md text-lg transition-all
                ${currentTool === tool 
                  ? 'bg-indigo-600 shadow-lg' 
                  : 'hover:bg-gray-600'
                }
              `}
              title={TOOL_CONFIGS[tool].name}
            >
              {TOOL_CONFIGS[tool].icon}
            </button>
          ))}
        </div>

        {/* Color Picker - disabled for eraser */}
        {currentTool !== 'eraser' && (
          <div className="flex gap-1 ml-2">
            {DEFAULT_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setCurrentColor(color)}
                className={`
                  w-7 h-7 rounded-full transition-transform
                  ${currentColor === color ? 'ring-2 ring-white scale-110' : 'hover:scale-105'}
                `}
                style={{ 
                  backgroundColor: color,
                  border: color === '#FFFFFF' ? '1px solid #666' : 'none'
                }}
              />
            ))}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ↩️ Undo
          </button>
          <button
            onClick={handleClear}
            disabled={strokes.length === 0 && textElements.length === 0}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🗑️ Clear
          </button>
          <button
            onClick={handleCapture}
            disabled={!onCapture || disabled}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📷 Send to AI
          </button>
        </div>
      </div>

      {/* Mode Indicator */}
      <div className="px-3 py-1.5 bg-gray-800/50 text-sm text-gray-400 flex items-center gap-2">
        <span className="font-medium">
          {mode === 'tictactoe' && '🎮 Tic-Tac-Toe Mode'}
          {mode === 'pictionary' && '🎨 Pictionary Mode'}
          {mode === 'freeform' && '✏️ Freeform Mode'}
        </span>
        {mode === 'tictactoe' && (
          <span className="text-xs text-gray-500">• Draw your X, then send to AI</span>
        )}
        {mode === 'pictionary' && (
          <span className="text-xs text-gray-500">• Draw something for the AI to guess!</span>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center bg-gray-900">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className={`
            bg-white rounded-lg shadow-2xl cursor-crosshair
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
    </div>
  );
});
export default Whiteboard;
