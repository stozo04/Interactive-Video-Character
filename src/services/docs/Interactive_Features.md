# Interactive Features

These services and systems handle the "fun" part of the app—minigames, shared drawing, and spontaneous emotional moments.

## Whiteboard Modes (`whiteboardModes.ts`)

Controls the shared canvas where Kayley can draw with you or play games.

*   **Modes**:
    *   **Tic-Tac-Toe**: A 3x3 grid where Kayley uses Computer Vision to "see" your X and place her O.
    *   **Pictionary / Guessing**: You draw, and she tries to guess what it is.
    *   **Freeform**: You both doodle together.
*   **LLM?**: **Yes.** The LLM receives a description of the board and outputs coordinates for lines, circles, or text to "draw" on the screen.
*   **ASCII Flow**:
```text
User draws an 'X' -> [Vision Analysis] -> "User put X in cell 0"
   |
[BaseAIService] -> [Whiteboard Logic] -> "I'll put my O in cell 4!"
   |
[UI] -> Draws circle in center
```

## Almost Moments (`almostMoments/`)

These are the "Retreat into Safety" moments where Kayley almost says something vulnerable but pulls back.

*   **System**: Tracks "Unsaid Feelings" (e.g., Kayley feeling proud of you but being too shy to say it directly).
*   **Trigger**: If the conversation gets deep, the `messageAnalyzer` might trigger a "Near Miss" where Kayley adds a hesitant phrase like "...anyway, never mind" to her response.
*   **Tables**: `kayley_unsaid_feelings`, `kayley_almost_moment_log`.

## Spontaneity (`spontaneity/`)

Handles events that happen "out of the blue."

*   **Selfies**: Kayley might decide to send you a photo of what she's doing.
*   **Topic Shifts**: She might suddenly bring up something she saw on the news if she thinks you'd like it.
*   **Tables**: `conversation_spontaneity_state`, `spontaneous_selfie_history`.

## Emotional Momentum

(Part of `moodKnobs.ts`). This tracks if you've been having a "good streak" of messages. If you have, Kayley's momentum increases, making her more likely to be playful or share a secret.
