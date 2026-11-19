/**
 * Client-IP authority.
 *
 * The server must bind rate limits, bans and attribution to the address the
 * visitor actually connects from — never to one the visitor typed into a
 * header. Two topologies reach this service:
 *
 *  1. Direct via the host ingress (Render/VPS Caddy): the ingress APPENDS the
 *     real connecting address to X-Forwarded-For (observed — the edge relay's
 *     XFF fix only worked because the ingress preserves/extends the chain).
 *     Client-supplied entries sit LEFT of it, so the rightmost entry is the
 *     authoritative one.
 *  2. Via our edge Worker (edge.traderkomak.ir): the Worker overwrites XFF
 *     with the Cloudflare-attested client address (CF-Connecting-IP), then the
 *     ingress appends the Worker's own Cloudflare egress address last. The
 *     chain therefore ends in a Cloudflare egress IP, and the real client is
 *     the entry just before it.
 *
 * Resolution rule (fail-safe at every step):
 *   - strip trailing private/loopback entries (internal ingress hops),
 *   - if the remaining chain ends in a Cloudflare egress IP (and has a
 *     predecessor), take that predecessor — a client can only place a
 *     Cloudflare address there by routing through our Worker,
 *   - otherwise take the rightmost entry, else the socket peer.
 *
 * Optional hardening: when EDGE_SHARED_SECRET is set on both the Worker and
 * this server, a request carrying the matching X-Tk-Edge-Auth header is
 * attributed to the FIRST XFF entry (exactly what the Worker attested), which
 * also closes the "attacker runs their own Cloudflare Worker" spoof that the
 * structural rule above cannot distinguish.
 *
 * Residual (documented in threat-model/2026-10-29-quick): without the shared
 * secret, an attacker running their OWN Cloudflare Worker can still forge the
 * client position. Trivial direct header forgery is fully closed.
 */
import { safeEqual } from "./secure.js";

/** Published Cloudflare IPv4 ranges (https://www.cloudflare.com/ips-v4). */
const CF_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];

/** Published Cloudflare IPv6 ranges (https://www.cloudflare.com/ips-v6). */
const CF_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const V4_PRIVATE: Array<[number, number]> = [
  [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
  [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
  [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
  [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
  [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
  [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],
];

function ipv4ToInt(ip: string): number {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return -1;
  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (a > 255 || b > 255 || c > 255 || d > 255) return -1;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const value = ipv4ToInt(ip);
  if (value < 0) return false;
  const slash = cidr.indexOf("/");
  const base = ipv4ToInt(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

function ipv6ToBigInt(ip: string): bigint | null {
  const doubleColon = ip.indexOf("::");
  let head: string[], tail: string[];
  if (doubleColon >= 0) {
    head = ip.slice(0, doubleColon).split(":").filter(Boolean);
    tail = ip.slice(doubleColon + 2).split(":").filter(Boolean);
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    head = [...head, ...Array<string>(missing).fill("0")];
  } else {
    head = ip.split(":");
    tail = [];
    if (head.length !== 8) return null;
  }
  let value = 0n;
  for (const group of [...head, ...tail]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  const value = ipv6ToBigInt(ip);
  const base = ipv6ToBigInt(cidr.slice(0, slash));
  if (value === null || base === null) return false;
  const bits = BigInt(Number(cidr.slice(slash + 1)));
  const mask = bits === 0n ? 0n : ((1n << bits) - 1n) << (128n - bits);
  return (value & mask) === (base & mask);
}

function isCloudflareEgress(ip: string): boolean {
  if (ip.includes(":")) return CF_V6.some((c) => ipv6InCidr(ip, c));
  return CF_V4.some((c) => ipv4InCidr(ip, c));
}

function isPrivateOrLoopback(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  const value = ipv4ToInt(ip);
  if (value < 0) return false;
  return V4_PRIVATE.some(([lo, hi]) => value >= lo && value <= hi);
}

interface IpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined } | undefined;
}

function xffEntries(req: IpRequestLike): string[] {
  const raw = req.headers["x-forwarded-for"];
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(",") : "";
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 64)
    .map((s) => s.slice(0, 64));
}

export function resolveClientIp(req: IpRequestLike, edgeSecret = ""): string {
  const marker = req.headers["x-tk-edge-auth"];
  const parts = xffEntries(req);

  // Our Worker attests the client address it put in XFF — trust it verbatim.
  if (
    edgeSecret &&
    typeof marker === "string" &&
    marker.length > 0 &&
    marker.length <= 128 &&
    safeEqual(marker, edgeSecret)
  ) {
    const attested = parts[0];
    if (attested) return attested;
  }

  // Strip internal infrastructure hops the ingress chain may have appended —
  // they are shared by every visitor and say nothing about the client.
  while (parts.length > 0 && isPrivateOrLoopback(parts[parts.length - 1]!)) parts.pop();
  if (parts.length === 0) {
    return (req.socket?.remoteAddress ?? "").slice(0, 64);
  }

  // Chain ends in a Cloudflare egress address → the request came through our
  // Worker; the client is the entry the Worker placed just before it.
  if (parts.length >= 2 && isCloudflareEgress(parts[parts.length - 1]!)) {
    return parts[parts.length - 2]!;
  }
  return parts[parts.length - 1]!;
}
