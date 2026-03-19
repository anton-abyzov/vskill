// ---------------------------------------------------------------------------
// data-events.ts -- server-side event bus for data change notifications
// ---------------------------------------------------------------------------
// Fires when benchmark completes, history is written, or leaderboard updates.
// Clients connect via GET /api/events (SSE) to receive push notifications.

import { EventEmitter } from "node:events";

export type DataEventType = "benchmark:complete" | "history:written" | "leaderboard:updated";

class DataEventBus extends EventEmitter {
  private static _instance: DataEventBus;

  static getInstance(): DataEventBus {
    if (!DataEventBus._instance) {
      DataEventBus._instance = new DataEventBus();
      DataEventBus._instance.setMaxListeners(100); // Allow many SSE clients
    }
    return DataEventBus._instance;
  }
}

export const dataEventBus = DataEventBus.getInstance();

/**
 * Emit a data change event to all connected SSE clients.
 */
export function emitDataEvent(event: DataEventType, payload?: unknown): void {
  dataEventBus.emit(event, payload);
}
