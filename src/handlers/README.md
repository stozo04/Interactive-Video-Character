# Handlers

Extracted handler modules used by the UI layer.

## Overview

Handlers are standalone functions that process specific domains. They do not own React state directly; they take dependencies as inputs and return results.

## Files

- `whiteboardHandler.ts`: Whiteboard/drawing mode AI interaction.
- `whiteboardHandler.README.md`: Whiteboard handler documentation.
- `messageActions/`: Response action handlers used by chat flow.

## messageActions Modules

- `calendarActions.ts`: Calendar parsing/action helpers.
- `newsActions.ts`: News fetch/format helpers.
- `selfieActions.ts`: Selfie generation helpers.
- `videoActions.ts`: Video generation helpers.
- `types.ts`: Shared action types/results.

## Note on Tasks

Local task handlers were intentionally removed.

Task intents now run through server-side function tools (`google_task_action` preferred, `google_cli` for advanced raw commands) via `gogcli`, not through client-side handlers.
