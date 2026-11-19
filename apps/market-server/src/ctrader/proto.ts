/**
 * Minimal protobuf definitions for the cTrader Open API.
 *
 * Field numbers and payload-type ids are copied verbatim from Spotware's
 * official .proto files (github.com/spotware/openapi-proto-messages):
 *   OpenApiCommonMessages.proto  — ProtoMessage, ProtoErrorRes, ProtoHeartbeatEvent
 *   OpenApiModelMessages.proto   — ProtoOALightSymbol, ProtoOASymbol,
 *                                  ProtoOATrendbar, ProtoOATickData,
 *                                  ProtoOAPayloadType enum
 *   OpenApiMessages.proto        — the ProtoOA* request/response/event messages
 *
 * Only the messages this integration uses are declared. Unknown fields are
 * skipped by the protobuf decoder, so a subset declaration stays wire-safe
 * when Spotware extends a message. `payloadType` is declared as plain
 * uint32 (wire-compatible with the enum) because we always set it
 * explicitly and never need protobuf enum validation.
 */
import protobuf, { type Type } from "protobufjs";

// ProtoOAPayloadType (OpenApiModelMessages.proto) + common ProtoPayloadType.
export const PT = {
  ERROR_RES: 50, // common ProtoErrorRes
  HEARTBEAT_EVENT: 51,
  APP_AUTH_REQ: 2100,
  APP_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  UNSUBSCRIBE_SPOTS_RES: 2130,
  SPOT_EVENT: 2131,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  OA_ERROR_RES: 2142, // ProtoOAErrorRes (session-scoped errors)
  GET_TICKDATA_REQ: 2145,
  GET_TICKDATA_RES: 2146,
  TOKEN_INVALIDATED_EVENT: 2147,
  CLIENT_DISCONNECT_EVENT: 2148,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
} as const;

// ProtoOATrendbarPeriod (OpenApiModelMessages.proto lines 574-589).
export const PERIOD = {
  M1: 1,
  M5: 5,
  M15: 7,
  M30: 8,
  H1: 9,
  H4: 10,
  D1: 12,
  W1: 13,
  MN1: 14,
} as const;

// ProtoOAQuoteType (OpenApiModelMessages.proto): tick-data side.
export const QUOTE_TYPE = { BID: 1, ASK: 2 } as const;

const PROTO_SOURCE = `
syntax = "proto2";

message ProtoMessage {
    required uint32 payloadType = 1;
    optional bytes payload = 2;
    optional string clientMsgId = 3;
}

message ProtoHeartbeatEvent {
    optional uint32 payloadType = 1;
}

message ProtoErrorRes {
    optional uint32 payloadType = 1;
    required string errorCode = 2;
    optional string description = 3;
    optional uint64 maintenanceEndTimestamp = 4;
}

message ProtoOAApplicationAuthReq {
    optional uint32 payloadType = 1;
    required string clientId = 2;
    required string clientSecret = 3;
}

message ProtoOAApplicationAuthRes {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
}

message ProtoOAAccountAuthReq {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    required string accessToken = 3;
}

message ProtoOAAccountAuthRes {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
}

message ProtoOAErrorRes {
    optional uint32 payloadType = 1;
    optional int64 ctidTraderAccountId = 2;
    required string errorCode = 3;
    optional string description = 4;
    optional int64 maintenanceEndTimestamp = 5;
    optional uint64 retryAfter = 6;
}

message ProtoOALightSymbol {
    required int64 symbolId = 1;
    optional string symbolName = 2;
    optional bool enabled = 3;
}

message ProtoOASymbolsListReq {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    optional bool includeArchivedSymbols = 3;
}

message ProtoOASymbolsListRes {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    repeated ProtoOALightSymbol symbol = 3;
}

message ProtoOASymbol {
    required int64 symbolId = 1;
    optional int32 digits = 2;
    optional int32 pipPosition = 3;
}

message ProtoOASymbolByIdReq {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    repeated int64 symbolId = 3;
}

message ProtoOASymbolByIdRes {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    repeated ProtoOASymbol symbol = 3;
}

message ProtoOATrendbar {
    required int64 volume = 3;
    optional uint32 period = 4;
    optional int64 low = 5;
    optional uint64 deltaOpen = 6;
    optional uint64 deltaClose = 7;
    optional uint64 deltaHigh = 8;
    optional uint32 utcTimestampInMinutes = 9;
}

message ProtoOAGetTrendbarsReq {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    optional int64 fromTimestamp = 3;
    optional int64 toTimestamp = 4;
    required uint32 period = 5;
    required int64 symbolId = 6;
    optional uint32 count = 7;
}

message ProtoOAGetTrendbarsRes {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    optional uint32 period = 3;
    repeated ProtoOATrendbar trendbar = 5;
    optional int64 symbolId = 6;
    optional bool hasMore = 7;
}

message ProtoOATickData {
    required int64 timestamp = 1;
    required int64 tick = 2;
}

message ProtoOAGetTickDataReq {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    required int64 symbolId = 3;
    required uint32 type = 4;
    optional int64 fromTimestamp = 5;
    optional int64 toTimestamp = 6;
}

message ProtoOAGetTickDataRes {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    repeated ProtoOATickData tickData = 3;
    required bool hasMore = 4;
}

message ProtoOASubscribeSpotsReq {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    repeated int64 symbolId = 3;
    optional bool subscribeToSpotTimestamp = 4;
}

message ProtoOASubscribeSpotsRes {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    repeated int64 subscribedSymbolId = 3;
}

message ProtoOAUnsubscribeSpotsReq {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    repeated int64 symbolId = 3;
}

message ProtoOASpotEvent {
    optional uint32 payloadType = 1;
    required int64 ctidTraderAccountId = 2;
    required int64 symbolId = 3;
    optional uint64 bid = 4;
    optional uint64 ask = 5;
    optional uint64 sessionClose = 7;
    optional int64 timestamp = 8;
}

message ProtoOAClientDisconnectEvent {
    optional uint32 payloadType = 1;
    optional string reason = 2;
}

message ProtoOACtidTraderAccount {
    required int64 ctidTraderAccountId = 1;
    optional bool isLive = 2;
    optional int64 traderLogin = 3;
    optional string brokerTitleShort = 6;
}

message ProtoOAGetAccountListByAccessTokenReq {
    optional uint32 payloadType = 1;
    required string accessToken = 2;
}

message ProtoOAGetAccountListByAccessTokenRes {
    optional uint32 payloadType = 1;
    required string accessToken = 2;
    repeated ProtoOACtidTraderAccount ctidTraderAccount = 4;
}

message ProtoOAAccountsTokenInvalidatedEvent {
    optional uint32 payloadType = 1;
    repeated int64 ctidTraderAccountIds = 2;
}
`;

const root = protobuf.parse(PROTO_SOURCE, { keepCase: false }).root;

/** Compiled message type by name — throws at startup on a typo above. */
function type(name: string): Type {
  const t = root.lookupType(name);
  return t;
}

export const M = {
  ProtoMessage: type("ProtoMessage"),
  ProtoHeartbeatEvent: type("ProtoHeartbeatEvent"),
  ProtoErrorRes: type("ProtoErrorRes"),
  ProtoOAApplicationAuthReq: type("ProtoOAApplicationAuthReq"),
  ProtoOAApplicationAuthRes: type("ProtoOAApplicationAuthRes"),
  ProtoOAAccountAuthReq: type("ProtoOAAccountAuthReq"),
  ProtoOAAccountAuthRes: type("ProtoOAAccountAuthRes"),
  ProtoOAErrorRes: type("ProtoOAErrorRes"),
  ProtoOALightSymbol: type("ProtoOALightSymbol"),
  ProtoOASymbolsListReq: type("ProtoOASymbolsListReq"),
  ProtoOASymbolsListRes: type("ProtoOASymbolsListRes"),
  ProtoOASymbol: type("ProtoOASymbol"),
  ProtoOASymbolByIdReq: type("ProtoOASymbolByIdReq"),
  ProtoOASymbolByIdRes: type("ProtoOASymbolByIdRes"),
  ProtoOATrendbar: type("ProtoOATrendbar"),
  ProtoOAGetTrendbarsReq: type("ProtoOAGetTrendbarsReq"),
  ProtoOAGetTrendbarsRes: type("ProtoOAGetTrendbarsRes"),
  ProtoOATickData: type("ProtoOATickData"),
  ProtoOAGetTickDataReq: type("ProtoOAGetTickDataReq"),
  ProtoOAGetTickDataRes: type("ProtoOAGetTickDataRes"),
  ProtoOASubscribeSpotsReq: type("ProtoOASubscribeSpotsReq"),
  ProtoOASubscribeSpotsRes: type("ProtoOASubscribeSpotsRes"),
  ProtoOAUnsubscribeSpotsReq: type("ProtoOAUnsubscribeSpotsReq"),
  ProtoOASpotEvent: type("ProtoOASpotEvent"),
  ProtoOAClientDisconnectEvent: type("ProtoOAClientDisconnectEvent"),
  ProtoOAAccountsTokenInvalidatedEvent: type("ProtoOAAccountsTokenInvalidatedEvent"),
  ProtoOAGetAccountListByAccessTokenReq: type("ProtoOAGetAccountListByAccessTokenReq"),
  ProtoOAGetAccountListByAccessTokenRes: type("ProtoOAGetAccountListByAccessTokenRes"),
} as const;

/**
 * int64/uint64 fields decode to `Long` instances (protobufjs bundles the
 * long library; its TS type only exposes low/high/unsigned + optional
 * toNumber). Every value this integration uses — account/symbol ids,
 * 1/100000-scaled prices, epoch-ms timestamps — sits far below 2^53, so a
 * plain Number is safe everywhere.
 */
interface LongLike {
  low: number;
  high: number;
  unsigned: boolean;
  toNumber?: () => number;
}

export function toNum(v: number | LongLike | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toNumber === "function") return v.toNumber();
  return v.unsigned
    ? v.high * 4294967296 + v.low
    : v.high * 4294967296 + (v.low >>> 0);
}

/** Decoded envelope: payload stays raw bytes until routed by payloadType. */
export interface Envelope {
  payloadType: number;
  payload?: Uint8Array;
  clientMsgId?: string | null;
}

export function decodeEnvelope(buf: Uint8Array): Envelope {
  return M.ProtoMessage.toObject(M.ProtoMessage.decode(buf), {
    defaults: false,
  }) as unknown as Envelope;
}

export function encodeEnvelope(env: {
  payloadType: number;
  payload?: Uint8Array;
  clientMsgId?: string;
}): Buffer {
  return M.ProtoMessage.encode(M.ProtoMessage.fromObject(env)).finish() as Buffer;
}

/**
 * TCP wire framing (help.ctrader.com/open-api/sending-receiving-protobuf):
 * a 4-byte BIG-endian Int32 header holding the BODY size only (header not
 * counted), followed by the protobuf body. The WebSocket gateway does NOT
 * need this (WS frames delimit messages) — the browser client speaks JSON
 * there.
 */
export function encodeFrame(body: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}
