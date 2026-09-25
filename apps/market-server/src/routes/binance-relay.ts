/**
 * Binance relay — lets OTHER TraderKomak servers located where Binance is
 * geo-blocked (451) stream market data through THIS deployment (which can
 * reach the data mirror).
 *
 * Routes (both gated by a secret path segment; disabled when
 * BINANCE_RELAY_SECRET is empty):
 *   GET /binance/:secret/api/*   → REST passthrough to data-api.binance.vision
 *   WS  /binance/:secret/ws/*    → bidirectional pipe to data-stream.binance.vision
 *
 * A downstream server configures:
 *   BINANCE_API_URL=https://edge.traderkomak.ir/binance/<secret>
 *   BINANCE_STREAM_URL=wss://edge.traderkomak.ir/binance/<secret>
 * Its clients then hit /binance/<secret>/api/v3/klines and
 * /binance/<secret>/ws/<symbol>@aggTrade exactly like the real endpoints.
 */
import type { FastifyInstance } from "fastify";
import WebSocket, { type RawData } from "ws";
import type { AppConfig } from "../config/env.js";

const REST_TARGET = "https://data-api.binance.vision";
const WS_TARGET = "wss://data-stream.binance.vision";
/** Cap on relayed frame size (Binance market frames are small). */
const MAX_FRAME_CHARS = 64 * 1024;

export function registerBinanceRelayRoute(app: FastifyInstance, config: AppConfig): void {
  const secret = config.binanceRelaySecret;
  if (!secret) return; // relay disabled

  const checkSecret = (s: unknown): boolean => typeof s === "string" && s.length <= 64 && s === secret;

  // ── REST passthrough (GET only — market data) ─────────────────────────
  app.get<{ Params: { secret: string; "*": string } }>("/binance/:secret/api/*", async (request, reply) => {
    if (!checkSecret(request.params.secret)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN" } });
    }
    const sub = String(request.params["*"] ?? "").replace(/\\/g, "/").slice(0, 200);
    if (!/^api\/v\d+[a-z0-9/._-]*$/i.test(sub)) {
      return reply.code(400).send({ error: { code: "BAD_PATH" } });
    }
    const qi = request.url.indexOf("?");
    const query = qi >= 0 ? request.url.slice(qi) : "";
    try {
      const res = await fetch(`${REST_TARGET}/${sub}${query}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.text();
      return reply
        .code(res.status)
        .header("Content-Type", res.headers.get("content-type") ?? "application/json")
        .send(body);
    } catch {
      return reply.code(502).send({ error: { code: "UPSTREAM_ERROR" } });
    }
  });

  // ── WS pipe (aggTrade market stream) ──────────────────────────────────
  app.get<{ Params: { secret: string; "*": string } }>("/binance/:secret/ws/*", { websocket: true }, (client, req) => {
    if (!checkSecret(req.params.secret)) {
      setTimeout(() => {
        try { client.close(1008, "forbidden"); } catch {}
      }, 50);
      return;
    }
    const sub = String(req.params["*"] ?? "").slice(0, 200);
    let upstream: WebSocket;
    try {
      upstream = new WebSocket(`${WS_TARGET}/${sub}`);
    } catch {
      try { client.close(1011, "relay dial failed"); } catch {}
      return;
    }

    const closeBoth = (): void => {
      try { client.close(); } catch {}
      try { upstream.close(); } catch {}
    };

    upstream.on("open", () => {
      // A downstream client may send SUBSCRIBE-style JSON frames — relay them
      client.on("message", (data: RawData) => {
        const text = typeof data === "string" ? data : data.toString();
        if (text.length <= MAX_FRAME_CHARS) {
          try { upstream.send(text); } catch {}
        }
      });
    });
    upstream.on("message", (data: RawData) => {
      const text = typeof data === "string" ? data : data.toString();
      if (text.length <= MAX_FRAME_CHARS) {
        try { client.send(text); } catch {}
      }
    });
    upstream.on("close", () => closeBoth());
    upstream.on("error", () => closeBoth());
    client.on("close", () => {
      try { upstream.close(); } catch {}
    });
    client.on("error", () => closeBoth());
  });
}
