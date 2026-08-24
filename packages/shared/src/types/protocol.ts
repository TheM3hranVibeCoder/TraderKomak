import type { Candle, Timeframe } from "../index.js";

/**
 * TraderKomak WebSocket protocol (v1).
 *
 * Transport: one WebSocket endpoint on the market server.
 * Framing: JSON text frames, one object per frame.
 *
 * Client → Server:
 *   { "type": "subscribe",   "instrument": "EUR_USD", "timeframe": "5s" }
 *   { "type": "unsubscribe" }
 *   { "type": "watch",       "instruments": ["EUR_USD","XAU_USD"] }
 *   { "type": "ping" }
 *
 * Server → Client:
 *   { "type": "snapshot", "instrument": "...", "timeframe": "...", "candles": [...] }
 *   { "type": "candle", "instrument": "...", "timeframe": "...", "data": {...}, "closed": false }
 *   { "type": "price", "instrument":"EUR_USD","bid":1.1,"ask":1.2,"mid":1.15,"timestamp":123,"change":0.001,"changePercent":0.05 }
 *   { "type": "status", "status": "connected" | "reconnecting" | "offline" }
 *   { "type": "pong" }
 *   { "type": "error", "message": "..." }
 */

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

export interface SubscribeMessage {
  type: "subscribe";
  instrument: string;
  timeframe: Timeframe;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
}

export interface WatchMessage {
  type: "watch";
  instruments: string[];
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | WatchMessage | PingMessage;

export interface SnapshotMessage {
  type: "snapshot";
  instrument: string;
  timeframe: Timeframe;
  candles: Candle[];
}

export interface CandleMessage {
  type: "candle";
  instrument: string;
  timeframe: Timeframe;
  data: Candle;
  closed: boolean;
}

export interface PriceMessage {
  type: "price";
  instrument: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  timestamp: number;
}

export interface StatusMessage {
  type: "status";
  status: ConnectionStatus;
}

export interface PongMessage {
  type: "pong";
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage =
  | SnapshotMessage
  | CandleMessage
  | PriceMessage
  | StatusMessage
  | PongMessage
  | ErrorMessage;
