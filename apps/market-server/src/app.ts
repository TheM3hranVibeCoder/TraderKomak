/**
 * Composition root: wires OANDA clients, aggregation feed, WebSocket hub,
 * HTTP routes and configuration into one independently deployable service.
 *
 * Dependency direction (enforced by imports):
 *   oanda adapter → market engine → websocket hub → routes → this file
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import * as path from "node:path";

import { serverLoggerOptions, type Log } from "./logger.js";
import type { AppConfig } from "./config/env.js";
import { OandaRestClient } from "./oanda/restClient.js";
import { OandaStreamClient } from "./oanda/streamClient.js";
import { BinanceRestClient } from "./binance/restClient.js";
import { BinanceStreamClient } from "./binance/streamClient.js";
import { CtraderClient } from "./ctrader/client.js";
import { CtraderRestClient } from "./ctrader/restClient.js";
import { CtraderStreamClient } from "./ctrader/streamClient.js";
import { CandleFeed } from "./market/candleFeed.js";
import { CandlePersist } from "./market/candlePersist.js";
import { MarketHub } from "./websocket/hub.js";
import { ChatRoom } from "./chat/chatRoom.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerCandlesRoute } from "./routes/candles.js";
import { registerCtraderSessionRoute } from "./routes/ctraderSession.js";
import { DukascopyStream } from "./dukascopy/stream.js";
import { getHistory as dukascopyHistory } from "./dukascopy/client.js";
import { registerNewsRoute } from "./routes/news.js";
import { registerBinanceRelayRoute } from "./routes/binance-relay.js";
import compress from "@fastify/compress";
import { providerOf } from "@traderkomak/shared";
import { resolveClientIp } from "./util/clientIp.js";

export interface MarketServer {
  app: FastifyInstance;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createMarketServer(config: AppConfig): Promise<MarketServer> {
  const app = Fastify({
    logger: serverLoggerOptions(config.logLevel),
    // trustProxy stays OFF: request.ip would otherwise be the LEFTMOST
    // X-Forwarded-For entry, which visitors forge at will. The visitor
    // address is resolved per environment into request.clientIp instead
    // (see util/clientIp.ts) — rate limits, chat bans and roster IPs bind
    // to that value.
    bodyLimit: 64 * 1024,
  });

  app.decorateRequest("clientIp", "");
  app.addHook("onRequest", (request, _reply, done) => {
    request.clientIp = resolveClientIp(request, config.edgeSharedSecret);
    done();
  });

  const streamLog: Log = app.log.child({ module: "oanda.stream" });
  const binanceLog: Log = app.log.child({ module: "binance.stream" });
  const feedLog: Log = app.log.child({ module: "market.feed" });
  const hubLog: Log = app.log.child({ module: "ws.hub" });

  await app.register(cors, {
    origin: config.corsOrigin.includes("*") ? true : config.corsOrigin,
    methods: ["GET"],
  });

  // gzip/br for REST responses — candle history (~200KB JSON) shrinks 5-10x
  // over the wire, which matters enormously on high-latency lossy paths.
  await app.register(compress, {
    global: true,
    encodings: ["gzip", "br"],
    threshold: 1024,
  });

  await app.register(websocket, {
    options: {
      maxPayload: 1_048_576,
      // Negotiate permessage-deflate with browsers: JSON tick/candle frames
      // compress ~3-5x, which directly cuts metered egress (the WS stream is
      // the biggest bandwidth consumer). No behavior change — clients that
      // don't offer the extension simply get uncompressed frames.
      perMessageDeflate: true,
    },
  });

  const oandaRest = new OandaRestClient({
    apiUrl: config.oanda.apiUrl,
    accountId: config.oanda.accountId,
    apiToken: config.oanda.apiToken,
  });

  const oandaStream = new OandaStreamClient(
    {
      streamUrl: config.oanda.streamUrl,
      accountId: config.oanda.accountId,
      apiToken: config.oanda.apiToken,
    },
    streamLog
  );

  const binanceRest = new BinanceRestClient({ apiUrl: config.binance.apiUrl });
  const binanceStream = new BinanceStreamClient(
    { streamUrl: config.binance.streamUrl },
    binanceLog
  );

  // cTrader (US30) — optional provider: without credentials the server runs
  // exactly as before and US30 charts surface a clear upstream error.
  const ctraderLog: Log = app.log.child({ module: "ctrader.session" });
  let ctraderClient: CtraderClient | null = null;
  let ctraderRest: CtraderRestClient | null = null;
  let ctraderStream: CtraderStreamClient | null = null;
  if (config.ctrader.enabled) {
    ctraderClient = new CtraderClient(
      {
        host: config.ctrader.host,
        port: config.ctrader.port,
        clientId: config.ctrader.clientId,
        clientSecret: config.ctrader.clientSecret,
        accountId: config.ctrader.accountId,
        accessToken: config.ctrader.accessToken,
        refreshToken: config.ctrader.refreshToken,
        tokenStorePath: path.join(config.dataDir, "ctrader-token.json"),
      },
      ctraderLog
    );
    ctraderRest = new CtraderRestClient(
      ctraderClient,
      ctraderLog,
      config.ctrader.symbolName || undefined
    );
    ctraderStream = new CtraderStreamClient(
      ctraderClient,
      ctraderRest.symbols,
      ctraderLog
    );
  } else {
    app.log.info("cTrader not configured — US30 served only when credentials are set");
  }

  /** Provider-aware history router — CandleFeed/routes stay agnostic. */
  const historyRouter = {
    async getNativeCandles(
      instrument: string,
      timeframe: Parameters<OandaRestClient["getNativeCandles"]>[1],
      count: number,
      toIso?: string
    ) {
      if (providerOf(instrument) === "dukascopy") {
        // Dukascopy history is already exact-timeframe (seconds come from
        // tick files) — resolveHistory passes it through unchanged.
        const duka = await dukascopyHistory(instrument, timeframe, count, toIso ? Math.floor(Date.parse(toIso) / 1000) : undefined);
        return duka.candles;
      }
      if (providerOf(instrument) === "ctrader") {
        if (!ctraderRest) {
          throw Object.assign(new Error("cTrader data unavailable — credentials not configured"), {
            code: "UPSTREAM_ERROR",
          });
        }
        return ctraderRest.getNativeCandles(instrument, timeframe, count, toIso);
      }
      const client = providerOf(instrument) === "binance" ? binanceRest : oandaRest;
      return client.getNativeCandles(instrument, timeframe, count, toIso);
    },
  };

  const feed = new CandleFeed(historyRouter, feedLog, new CandlePersist(config.dataDir, feedLog));
  const dukascopyStream = new DukascopyStream(feedLog);
  const hub = new MarketHub(feed, oandaStream, hubLog, binanceStream, ctraderStream ?? undefined);

  // Live-data pipeline (both providers → normalized tick → feed + watchlist)
  oandaStream.on("tick", (tick) => {
    feed.handleTick(tick);
    hub.onPriceTick(tick);
  });
  binanceStream.on("tick", (tick) => {
    feed.handleTick(tick);
    hub.onPriceTick(tick);
  });
  dukascopyStream.on("tick", (tick) => {
    feed.handleTick(tick);
    hub.onPriceTick(tick);
  });
  ctraderStream?.on("tick", (tick) => {
    feed.handleTick(tick);
    hub.onPriceTick(tick);
  });
  feed.on("candle", (event) => hub.onCandleEvent(event));

  // Aggregate per-provider statuses into one upstream status for clients
  const providerStatus: Record<"oanda" | "binance" | "dukascopy" | "ctrader", "connected" | "reconnecting" | "offline"> = {
    oanda: "offline",
    binance: "offline",
    dukascopy: "offline",
    // Disabled cTrader stays "offline" so it never masks the other providers.
    ctrader: "offline",
  };
  function aggregateStatus(): "connected" | "reconnecting" | "offline" {
    if (
      providerStatus.oanda === "connected" ||
      providerStatus.binance === "connected" ||
      providerStatus.dukascopy === "connected" ||
      providerStatus.ctrader === "connected"
    ) {
      return "connected";
    }
    if (
      providerStatus.oanda === "reconnecting" ||
      providerStatus.binance === "reconnecting" ||
      providerStatus.dukascopy === "reconnecting" ||
      providerStatus.ctrader === "reconnecting"
    ) {
      return "reconnecting";
    }
    return "offline";
  }
  function onProviderStatus(p: "oanda" | "binance" | "dukascopy" | "ctrader") {
    return (s: "connected" | "reconnecting" | "offline") => {
      providerStatus[p] = s;
      hub.setUpstreamStatus(aggregateStatus());
    };
  }
  oandaStream.on("status", onProviderStatus("oanda"));
  binanceStream.on("status", onProviderStatus("binance"));
  dukascopyStream.on("status", onProviderStatus("dukascopy"));
  ctraderStream?.on("status", onProviderStatus("ctrader"));

  registerHealthRoute(app);
  registerCandlesRoute(app, { rest: historyRouter, feed });
  registerNewsRoute(app);
  registerBinanceRelayRoute(app, config);
  registerCtraderSessionRoute(app, {
    // Serves the LIVE session config (accessToken reflects refreshes) for
    // the browser-direct path; null when cTrader is not configured.
    getSession: () => {
      if (!ctraderClient || !config.ctrader.enabled) return null;
      const info = ctraderClient.sessionInfo();
      // accountId may still be mid-discovery on the very first boot —
      // 503 until then; browsers simply fall back / retry.
      if (!info.accountId || !info.accessToken) return null;
      return {
        clientId: info.clientId,
        clientSecret: info.clientSecret,
        accountId: info.accountId,
        accessToken: info.accessToken,
        host: info.host,
        port: 5036, // JSON WebSocket gateway (protobuf TCP is 5035)
      };
    },
  });
  hub.register(app);

  // Community chat room (public, WebSocket on /chat)
  const chatLog = app.log.child({ module: "chat" });
  let chatRoomRef: ChatRoom | null = null;
  const chatRoom = new ChatRoom(config.dataDir, config.chatAdminKey, chatLog, config.chatOwnerNick);
  chatRoom.register(app);
  chatRoomRef = chatRoom;

  async function start(): Promise<void> {
    feed.startPersistent(config.persistentAggregations);
    const instruments = feed.instrumentUnion();
    if (instruments.length > 0) {
      oandaStream.setInstruments(instruments.filter((i) => providerOf(i) === "oanda"));
      binanceStream.setInstruments(instruments.filter((i) => providerOf(i) === "binance"));
      dukascopyStream.setInstruments(instruments.filter((i) => providerOf(i) === "dukascopy"));
      ctraderStream?.setInstruments(instruments.filter((i) => providerOf(i) === "ctrader"));
    }
    oandaStream.start();
    dukascopyStream.start();
    ctraderClient?.start();
    ctraderStream?.start();
    hub.startPingLoop();
    await app.listen({ port: config.port, host: config.host });
  }

  async function stop(): Promise<void> {
    hub.stopPingLoop();
    hub.closeAll();
    chatRoomRef?.closeAll();
    await oandaStream.stop();
    await dukascopyStream.stop();
    await binanceStream.stopAll();
    await ctraderStream?.stop();
    await ctraderClient?.stop();
    await app.close();
  }

  return { app, start, stop };
}
