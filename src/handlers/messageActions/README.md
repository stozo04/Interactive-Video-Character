# Message Action Handlers

Handlers for action-specific response processing used by chat orchestration.

## Current Scope

These handlers process presentation/action domains that remain client-coordinated:

- Calendar helpers (`calendarActions.ts`)
- News actions (`newsActions.ts`)
- Selfie actions (`selfieActions.ts`)
- Video actions (`videoActions.ts`)

## Directory

- `index.ts`: consolidated exports
- `types.ts`: shared enums/interfaces
- `calendarActions.ts`
- `newsActions.ts`
- `selfieActions.ts`
- `videoActions.ts`

## Design Principles

1. Pure functions where possible.
2. Explicit result objects (`handled`, `success`, payload fields).
3. Defensive error handling.
4. Keep side effects minimal and explicit.

## Usage

```ts
import {
  processNewsAction,
  processSelfieAction,
  processVideoAction,
} from './handlers/messageActions';
```

## Task Handling Note

Task requests are executed as function calls on the server side (`google_task_action` first, `google_cli` for advanced/raw cases) using Google Tasks via `gogcli`. Do not add client-side task parsing/CRUD here.
