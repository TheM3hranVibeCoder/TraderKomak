/**
 * GET /api/ctrader-session — hands the browser the connection details for
 * the DIRECT cTrader path (ctraderDirect.ts): the visitor's own internet
 * carries all candle/tick data, exactly like the OANDA and Binance paths.
 *
 * What is served and why it is safe:
 *   clientId + clientSecret — REQUIRED by the Open API's per-connection
 *     ProtoOAApplicationAuthReq handshake; there is no way for a browser
 *     to open its own cTrader session without them. They identify the
 *     registered market-data app (demo credentials, no trading scope
 *     needed) — the same trust model as the OANDA practice-token pool the
 *     web bundle already carries.
 *   accessToken — the CURRENT token, auto-refreshed server-side (the
 *     ~30-day OAuth token would otherwise break the site monthly).
 *   The REFRESH token is deliberately NOT served: rotation stays
 *   single-flight on the server, so one visitor can never invalidate
 *   another visitor's session.
 *
 * A ~200-byte JSON per visitor — candle data never touches this server.
 */
import type { FastifyInstance, FastifyReply } from "fastify";

export interface CtraderSessionPublic {
  clientId: string;
  clientSecret: string;
  accountId: string;
  accessToken: string;
  host: string;
  port: number;
}

interface CtraderSessionRouteDeps {
  getSession: () => CtraderSessionPublic | null;
}

export function registerCtraderSessionRoute(
  app: FastifyInstance,
  deps: CtraderSessionRouteDeps
): void {
  app.get("/api/ctrader-session", async (_request, reply: FastifyReply) => {
    const session = deps.getSession();
    if (!session) {
      return reply.code(503).send({
        error: { code: "UNAVAILABLE", message: "cTrader is not configured on this deployment" },
      });
    }
    return reply.send(session);
  });
}
