/**
 * Dukascopy .bi5 decoding.
 *
 * The datafeed serves LZMA-compressed binary records:
 *   • minute-candle files: 24-byte records
 *       int32 BE seconds-since-file-period-start · float32 open · close ·
 *       low · high · float32 volume
 *   • tick files (one per hour): 20-byte records
 *       int32 BE milliseconds-since-hour-start · float32 ask · bid ·
 *       askVolume · bidVolume
 * Prices are integer "points" — divide by the instrument's factor.
 */
import LZMA from "lzma-native";

export function decompressBi5(buf: Buffer): Buffer {
  // lzma-native handles the .lzma "alone" container the datafeed uses;
  // empty files (no data in period) arrive as 0 bytes.
  if (buf.length === 0) return Buffer.alloc(0);
  return LZMA.decompress(buf) as Buffer;
}

export interface Bi5Candle {
  offsetSec: number;
  open: number;
  close: number;
  low: number;
  high: number;
  volume: number;
}

export function parseMinuteCandles(raw: Buffer): Bi5Candle[] {
  const out: Bi5Candle[] = [];
  for (let off = 0; off + 24 <= raw.length; off += 24) {
    out.push({
      offsetSec: raw.readInt32BE(off),
      open: raw.readFloatBE(off + 4),
      close: raw.readFloatBE(off + 8),
      low: raw.readFloatBE(off + 12),
      high: raw.readFloatBE(off + 16),
      volume: raw.readFloatBE(off + 20),
    });
  }
  return out;
}

export interface Bi5Tick {
  offsetMs: number;
  ask: number;
  bid: number;
  askVolume: number;
  bidVolume: number;
}

export function parseTicks(raw: Buffer): Bi5Tick[] {
  const out: Bi5Tick[] = [];
  for (let off = 0; off + 20 <= raw.length; off += 20) {
    out.push({
      offsetMs: raw.readInt32BE(off),
      ask: raw.readFloatBE(off + 4),
      bid: raw.readFloatBE(off + 8),
      askVolume: raw.readFloatBE(off + 12),
      bidVolume: raw.readFloatBE(off + 16),
    });
  }
  return out;
}
