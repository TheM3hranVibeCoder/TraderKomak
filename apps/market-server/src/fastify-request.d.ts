/**
 * Client-IP authority: request.clientIp is resolved per environment by the
 * onRequest hook in app.ts (see util/clientIp.ts) — never trust raw
 * X-Forwarded-For, which visitors can forge.
 */
import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved visitor address (rate limits, bans, roster IPs bind to this). */
    clientIp: string;
  }
}
