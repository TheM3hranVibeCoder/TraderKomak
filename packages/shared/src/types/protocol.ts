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

/* ── Community chat protocol (v1) ──────────────────────────────────────
   Transport: a separate WebSocket endpoint (/chat) on the market server.
   Framing: JSON text frames, one object per frame.
   A message carries either text, an inline image (data URL) or both. */

/** Quote block attached to a chat message (a reply). The excerpt is cut
 *  server-side so clients can render the quote without a history lookup. */
export interface ChatReplyRef {
  id: string;
  from: string;
  text?: string;
  /** True when the quoted message was a photo (no text). */
  img?: boolean;
}

export interface ChatMessage {
  id: string;
  from: string;
  text?: string;
  /** Inline image as a data URL (compressed, ≤ ~280KB). */
  img?: string;
  ts: number;
  /** True when the author is the room owner/moderator. */
  owner?: boolean;
  /** The message this one replies to, if any. */
  reply?: ChatReplyRef;
}

export interface ChatJoinMessage {
  type: "join";
  nick: string;
  adminKey?: string;
}

export interface ChatSendTextMessage {
  type: "chat";
  text: string;
}

export interface ChatSendImageMessage {
  type: "chat";
  img: string;
}

export interface ChatDeleteMessage {
  type: "delete";
  id: string;
}

export interface ChatHistoryMessage {
  type: "history";
  messages: ChatMessage[];
}

export interface ChatBroadcastMessage {
  type: "chat";
  id: string;
  from: string;
  text?: string;
  img?: string;
  ts: number;
  owner?: boolean;
  reply?: ChatReplyRef;
}

export interface ChatOnlineMessage {
  type: "online";
  count: number;
  /** Sorted list of online nicknames (all clients). */
  nicks?: string[];
  /** Full member roster — sent to admins only. */
  known?: { nick: string; lastSeen: number; online: boolean }[];
}

export interface ChatSystemMessage {
  type: "system";
  text: string;
  ts: number;
}

export interface ChatDeletedMessage {
  type: "deleted";
  id: string;
}

export interface ChatMutedMessage {
  type: "muted";
  /** Epoch ms when the mute lifts. */
  until: number;
}

export interface ChatUnmutedMessage {
  type: "unmuted";
}

export interface ChatRateLimitMessage {
  type: "ratelimit";
  /** Epoch ms when the sender may chat again. */
  waitMs: number;
}

/* Admin tools (v1 additions): user info, direct messages, TG popup. */
export interface ChatUserInfoMessage {
  type: "userinfo";
  nick: string;
  lastIp: string | null;
  online: boolean;
  country: string | null;
}
export interface ChatAdminDmMessage {
  type: "admin_dm";
  id: string;
  text?: string;
  /** Inline photo (compressed data URL, ≤ ~280KB) like chat images. */
  img?: string;
}
export interface ChatDmStatusMessage {
  type: "dm_status";
  id: string;
  nick: string;
  read: boolean;
  offline: boolean;
}
export interface ChatTgPopupMessage {
  type: "tg_popup";
  id: string;
}
export interface ChatTgResultMessage {
  type: "tg_result";
  nick: string;
  id: string;
  action: "join" | "close";
}

export type ChatServerMessage =
  | ChatHistoryMessage
  | ChatBroadcastMessage
  | ChatOnlineMessage
  | ChatSystemMessage
  | ChatDeletedMessage
  | ChatModStateMessage
  | ChatMutedMessage
  | ChatUnmutedMessage
  | ChatRateLimitMessage
  | ChatUserInfoMessage
  | ChatAdminDmMessage
  | ChatDmStatusMessage
  | ChatTgPopupMessage
  | ChatTgResultMessage
  | PongMessage
  | ErrorMessage;

/* Chat moderation types (admin only) */
export interface ChatModerateMessage {
  type: "moderate";
  action: "mute" | "ban" | "unmute" | "unban";
  nick: string;
  /** Minutes for a mute (ignored for ban/unmute/unban). */
  minutes?: number;
}

export interface ChatModEntry {
  nick: string;
  /** Epoch ms — mute expiry (bans are permanent until lifted). */
  until?: number;
  /** Known IPs of a banned user (a nick alone is bypassable). */
  ips?: string[];
}

export interface ChatModStateMessage {
  type: "mod";
  mutes: ChatModEntry[];
  bans: ChatModEntry[];
}
