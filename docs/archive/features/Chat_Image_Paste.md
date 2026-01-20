# Chat Image Paste (Implementation Plan)

## Executive Summary
Add clipboard image pasting to the chat input so users can paste an image and send it with their text in a single message. This removes the current file-save-and-select workflow while keeping the existing image upload button as a fallback.

## Goals
- Paste an image from the clipboard directly into the chat input (Ctrl+V / Cmd+V).
- Allow text and image to be sent together in a single message.
- Show a preview of the pasted image with a clear remove action.
- Preserve current "image only" send capability.

## Non-Goals
- Multi-image attachments in a single message (out of scope for v1).
- Drag-and-drop attachments (optional future enhancement).
- Persisting pasted images to storage (base64 only for runtime send).

## Current Behavior (Baseline)
- `src/components/ChatPanel.tsx` supports image upload via hidden file input.
- `src/App.tsx` handles `handleSendImage(base64, mimeType)` and sends a fixed prompt (`"What do you think of this?"`).
- Chat history displays the image in a user message bubble with `msg.image` but hardcodes `image/jpeg` as the data URI type.

## Proposed UX
1. User presses Ctrl+V / Cmd+V inside the chat textarea.
2. If the clipboard contains an image, it appears as a small preview chip above the input.
3. The user can type text (before or after pasting) and hit Send.
4. The message sends as a single "image + text" payload to the AI.
5. If no text is provided, send with a fallback prompt (same as current behavior).

## Data Flow (High Level)
```
Clipboard -> ChatPanel (onPaste) -> pendingImage -> onSendMessage(payload)
-> App.tsx -> activeService.generateResponse(image_text)
-> chatHistory + conversationHistory append
```

## Implementation Details

### 1) ChatPanel: Clipboard + Pending Image State
Add a local state to hold the pending pasted image until the user sends.

- New state (example):
  - `const [pendingImage, setPendingImage] = useState<UploadedImage | null>(null);`
- Add `onPaste` handler to the textarea:
  - Read `event.clipboardData.items`.
  - Find the first item whose `type` starts with `image/`.
  - Convert to `File` via `getAsFile()` and to base64 via `FileReader`.
  - Set `pendingImage` (do not auto-send).
  - Do not block normal text paste; allow text to paste as usual.
- Add a preview UI block above the input:
  - Shows thumbnail and a remove button (`Remove` or `X`).
  - Shows file size/type if helpful.
- Update the image upload button behavior:
  - Selecting a file should set `pendingImage` instead of immediately sending.
  - This unifies both file select and paste into a single send flow.

### 2) Message Send Logic (ChatPanel -> App)
Allow `onSendMessage` to include optional image data.

Option A (minimal surface change):
- Update `onSendImage` to accept `text`:
  - `onSendImage?: (payload: { text: string; base64: string; mimeType: string }) => void`
  - Use this when `pendingImage` exists; otherwise use `onSendMessage`.

Option B (cleaner, preferred):
- Replace `onSendImage` with a single send handler:
  - `onSendMessage: (message: string, image?: { base64: string; mimeType: string }) => void`
  - In ChatPanel, call `onSendMessage(input, pendingImage ? { base64, mimeType } : undefined)`

Also update send button enablement:
- Allow Send if `input.trim()` is non-empty OR `pendingImage` exists.

### 3) App.tsx: Unified Send Handler for Text + Image
Unify message send path to support text and image in one call.

Suggested changes:
- Update `handleSendMessage` signature to accept optional image data.
- When `image` is provided:
  - Add the user message to `chatHistory` with both `text` and `image`.
  - Use `activeService.generateResponse` with:
    - `type: 'image_text'`
    - `text: userText || "What do you think of this?"`
    - `imageData: base64`
    - `mimeType`
  - Append conversation history using the user text (or a short placeholder if empty).
- Keep existing text-only flow intact when no image is attached.

### 4) ChatMessage Type: Preserve Image MIME Type
The chat bubble currently assumes `image/jpeg` for user images. That breaks for PNGs.

Add a field in `src/types.ts`:
- `imageMimeType?: string`

Update render in `ChatPanel`:
- Use `data:${msg.imageMimeType || 'image/jpeg'};base64,${msg.image}`

### 5) Size Limits and Error Handling
To avoid large base64 payloads:
- Add a maximum size check (example: 8 MB) before converting to base64.
- If too large, show an error and do not attach.

### 6) Logging
Add light logging in App or ChatPanel for image paste events:
- Example: `console.log("[PasteImage] clipboard image attached");`

## Files to Modify
- `src/components/ChatPanel.tsx`
  - Clipboard paste handler
  - Pending image preview UI
  - Send button enablement
  - Updated props signature
- `src/App.tsx`
  - Unified send handler for text + image
  - Chat history entry with text + image
  - Conversation history append with actual text
- `src/types.ts`
  - Add `imageMimeType?: string` to `ChatMessage`
- (Optional) `src/utils/clipboardUtils.ts`
  - Helper to extract image file and convert to base64 (testable)

## Edge Cases
- Clipboard contains multiple images: attach the first and ignore the rest.
- Clipboard contains text + image: allow text to paste normally, attach image.
- Pasting while a pending image exists: replace with the new image (no prompt).
- Image-only send: use fallback prompt text.

## Testing Plan
Manual tests (primary):
1. Paste a screenshot with no text, hit Send, verify image is sent and AI responds.
2. Paste an image, type a caption, send, verify both image and text appear.
3. Paste text only, ensure normal behavior.
4. Use the image button to attach a file, then type text and send.
5. Try a PNG to ensure correct mime type display.
6. Try a large image to confirm size limit error behavior.

Optional unit tests (if helpers are created):
- `src/utils/__tests__/clipboardUtils.test.ts`
  - Validate that image items are detected and size limits enforced.

## Future Enhancements
- Multi-image support with a small attachment tray.
- Drag-and-drop images into chat area.
- Inline image captions rendered in the chat bubble header.
