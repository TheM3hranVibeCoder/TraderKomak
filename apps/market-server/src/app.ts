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

import { serverLoggerOptions, type Log } from "./logger.js";
import type { AppConfig } from "./config/env.js";
import { OandaRestClient } from "./oanda/restClient.js";
import { OandaStreamClient } from "./oanda/streamClient.js";
import { BinanceRestClient } from "./binance/restClient.js";
import { BinanceStreamClient } from "./binance/streamClient.js";
import { CandleFeed } from "./market/candleFeed.js";
import { CandlePersist } from "./market/candlePersist.js";
import { MarketHub } from "./websocket/hub.js";
import { ChatRoom } from "./chat/chatRoom.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerCandlesRoute } from "./routes/candles.js";
import { DukascopyStream } from "./dukascopy/stream.js";
import { getHistory as dukascopyHistory } from "./dukascopy/client.js";
import { registerNewsRoute } from "./routes/news.js";
import { registerBinanceRelayRoute } from "./routes/binance-relay.js";
import compress from "@fastify/compress";
import { providerOf } from "@traderkomak/shared";

export interface MarketServer {
  app: FastifyInstance;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createMarketServer(config: AppConfig): Promise<MarketServer> {
  const app = Fastify({
    logger: serverLoggerOptions(config.logLevel),
    trustProxy: true,
    bodyLimit: 64 * 1024,
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
    options: { maxPayload: 1_048_576 },
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
      const client = providerOf(instrument) === "binance" ? binanceRest : oandaRest;
      return client.getNativeCandles(instrument, timeframe, count, toIso);
    },
  };

  const feed = new CandleFeed(historyRouter, feedLog, new CandlePersist(config.dataDir, feedLog));
  const dukascopyStream = new DukascopyStream(feedLog);
  const hub = new MarketHub(feed, oandaStream, hubLog, binanceStream);

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
  feed.on("candle", (event) => hub.onCandleEvent(event));

  // Aggregate per-provider statuses into one upstream status for clients
  const providerStatus: Record<"oanda" | "binance" | "dukascopy", "connected" | "reconnecting" | "offline"> = {
    oanda: "offline",
    binance: "offline",
    dukascopy: "offline",
  };
  function aggregateStatus(): "connected" | "reconnecting" | "offline" {
    if (
      providerStatus.oanda === "connected" ||
      providerStatus.binance === "connected" ||
      providerStatus.dukascopy === "connected"
    ) {
      return "connected";
    }
    if (
      providerStatus.oanda === "reconnecting" ||
      providerStatus.binance === "reconnecting" ||
      providerStatus.dukascopy === "reconnecting"
    ) {
      return "reconnecting";
    }
    return "offline";
  }
  function onProviderStatus(p: "oanda" | "binance" | "dukascopy") {
    return (s: "connected" | "reconnecting" | "offline") => {
      providerStatus[p] = s;
      hub.setUpstreamStatus(aggregateStatus());
    };
  }
  oandaStream.on("status", onProviderStatus("oanda"));
  binanceStream.on("status", onProviderStatus("binance"));
  dukascopyStream.on("status", onProviderStatus("dukascopy"));

  registerHealthRoute(app);
  registerCandlesRoute(app, { rest: historyRouter, feed });
  registerNewsRoute(app);
  registerBinanceRelayRoute(app, config);
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
    }
    oandaStream.start();
    dukascopyStream.start();
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
    await app.close();
  }

  return { app, start, stop };
}
