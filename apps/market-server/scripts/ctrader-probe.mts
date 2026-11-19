/**
 * One-shot cTrader credential probe — verifies the TLS endpoint, the
 * framing, and whether the app credentials authenticate, WITHOUT any
 * account token. Prints the raw response payload type so "app not active
 * yet" is distinguishable from "wrong credentials".
 *
 * Usage: npx tsx scripts/ctrader-probe.mts   (reads CTRADER_* from .env)
 */
import * as tls from "node:tls";
import * as fs from "node:fs";
import * as path from "node:path";
import { PT, M, decodeEnvelope, encodeEnvelope, encodeFrame } from "../src/ctrader/proto.js";

// Minimal .env load (same first-match rule as src/config/env.ts)
function loadEnv(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(process.cwd(), "../../../.env"),
  ];
  for (const file of candidates) {
    try {
      const out: Record<string, string> = {};
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
      }
      return out;
    } catch {
      /* next candidate */
    }
  }
  return {};
}

const env = loadEnv();
const clientId = env.CTRADER_CLIENT_ID ?? "";
const clientSecret = env.CTRADER_CLIENT_SECRET ?? "";
if (!clientId || !clientSecret) {
  console.error("CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET not set in .env");
  process.exit(1);
}

console.log(`connecting to ${env.CTRADER_HOST ?? "demo.ctraderapi.com"}:${env.CTRADER_PORT ?? "5035"} …`);

const socket = tls.connect({
  host: env.CTRADER_HOST ?? "demo.ctraderapi.com",
  port: Number.parseInt(env.CTRADER_PORT ?? "5035", 10),
  servername: env.CTRADER_HOST ?? "demo.ctraderapi.com",
});

const NAMES: Record<number, string> = {
  50: "ERROR_RES",
  51: "HEARTBEAT_EVENT",
  2101: "APPLICATION_AUTH_RES",
  2103: "ACCOUNT_AUTH_RES",
  2142: "OA_ERROR_RES",
  2148: "CLIENT_DISCONNECT_EVENT",
};

let buffer = Buffer.alloc(0);
socket.on("secureConnect", () => {
  console.log("TLS connected — sending ApplicationAuthReq …");
  const body = M.ProtoOAApplicationAuthReq.encode(
    M.ProtoOAApplicationAuthReq.fromObject({
      payloadType: PT.APP_AUTH_REQ,
      clientId,
      clientSecret,
    })
  ).finish();
  socket.write(encodeFrame(encodeEnvelope({ payloadType: PT.APP_AUTH_REQ, payload: body as Uint8Array, clientMsgId: "probe-1" })));
});
socket.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    if (buffer.length < 4) return;
    const total = buffer.readUInt32BE(0); // header = BODY size, big-endian
    if (buffer.length < total + 4) return;
    const body = buffer.subarray(4, total + 4);
    buffer = buffer.subarray(total + 4);
    const env2 = decodeEnvelope(body);
    const name = NAMES[env2.payloadType] ?? `payloadType ${env2.payloadType}`;
    if (env2.payloadType === PT.OA_ERROR_RES || env2.payloadType === PT.ERROR_RES) {
      try {
        const dec =
          env2.payloadType === PT.OA_ERROR_RES
            ? (M.ProtoOAErrorRes.toObject(M.ProtoOAErrorRes.decode(env2.payload ?? new Uint8Array()), { defaults: false }) as { errorCode?: string; description?: string })
            : (M.ProtoErrorRes.toObject(M.ProtoErrorRes.decode(env2.payload ?? new Uint8Array()), { defaults: false }) as { errorCode?: string; description?: string });
        console.log(`← ${name}: errorCode=${dec.errorCode ?? "?"} description=${dec.description ?? ""}`);
      } catch {
        console.log(`← ${name} (undecodable payload)`);
      }
    } else if (env2.payloadType === PT.APP_AUTH_RES) {
      const dec = M.ProtoOAApplicationAuthRes.toObject(M.ProtoOAApplicationAuthRes.decode(env2.payload ?? new Uint8Array()), { defaults: false }) as { ctidTraderAccountId?: unknown };
      console.log(`← ${name}: application credentials VALID ✓ (ctidTraderAccountId echoed: ${String(dec.ctidTraderAccountId)})`);
    } else {
      console.log(`← ${name}`);
    }
    socket.destroy();
    process.exit(0);
  }
});
socket.on("error", (err: Error) => {
  console.error(`socket error: ${err.message}`);
  process.exit(1);
});
socket.setTimeout(15_000, () => {
  console.error("timeout — no response in 15s");
  socket.destroy();
  process.exit(1);
});
