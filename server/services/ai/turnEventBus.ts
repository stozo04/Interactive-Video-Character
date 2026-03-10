// server/services/ai/turnEventBus.ts
//
// Per-request EventEmitter for SSE streaming.
// Created in the route handler, threaded to tool bridge.
// Not global — avoids cross-request event leakage.

import { EventEmitter } from 'node:events';

export class TurnEventBus extends EventEmitter {
  private _callIndex = 0;

  /** Returns the next sequential tool call index for this turn. */
  nextCallIndex(): number {
    return this._callIndex++;
  }
}
