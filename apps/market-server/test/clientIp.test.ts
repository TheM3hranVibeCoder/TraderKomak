import { describe, it, expect } from "vitest";
import { resolveClientIp } from "../src/util/clientIp";

function req(headers: Record<string, string>, remote = "198.51.100.1") {
  return { headers, socket: { remoteAddress: remote } };
}

describe("resolveClientIp", () => {
  it("takes the rightmost entry — a forged leftmost XFF is ignored", () => {
    const ip = resolveClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }));
    expect(ip).toBe("203.0.113.7");
  });

  it("single forwarded entry is the client (ingress-appended)", () => {
    const ip = resolveClientIp(req({ "x-forwarded-for": "203.0.113.7" }));
    expect(ip).toBe("203.0.113.7");
  });

  it("no chain falls back to the socket peer", () => {
    const ip = resolveClientIp(req({}, "198.51.100.9"));
    expect(ip).toBe("198.51.100.9");
  });

  it("edge-worker path: chain ending in a Cloudflare egress IP attributes the predecessor", () => {
    // edge worker overwrites XFF with the client, ingress appends its CF egress
    const ip = resolveClientIp(
      req({ "x-forwarded-for": "203.0.113.7, 162.158.100.5" })
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("edge-worker path over IPv6 egress", () => {
    const ip = resolveClientIp(
      req({ "x-forwarded-for": "203.0.113.7, 2606:4700::6810:84e5" })
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("a lone Cloudflare IP stays the client (guard: chain length)", () => {
    // WARP-style visitor: their real address IS a Cloudflare IP
    const ip = resolveClientIp(req({ "x-forwarded-for": "104.28.5.9" }));
    expect(ip).toBe("104.28.5.9");
  });

  it("internal ingress hops (private ranges) are stripped before resolution", () => {
    const ip = resolveClientIp(
      req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.3" })
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("valid edge marker attributes the FIRST entry outright", () => {
    const ip = resolveClientIp(
      req({ "x-forwarded-for": "203.0.113.7", "x-tk-edge-auth": "s3cret" }),
      "s3cret"
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("a WRONG edge marker falls back to the structural rules", () => {
    const ip = resolveClientIp(
      req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7", "x-tk-edge-auth": "bad" }),
      "s3cret"
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("with no secret configured the marker is ignored", () => {
    const ip = resolveClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7", "x-tk-edge-auth": "s3cret" }));
    expect(ip).toBe("203.0.113.7");
  });
});
