/**
 * cTrader symbol registry — maps canonical TraderKomak instruments (US30)
 * to the broker's numeric symbolId + price digits.
 *
 * Symbol ids differ per broker/server environment, and the exact symbol
 * NAME varies too ("US30", "US30.cash", "USA30", "DJI30"…). Resolution
 * order: the CTRADER_US30_SYMBOL env override, an exact "US30" match, then
 * the documented aliases — enabled symbols only. digits comes from
 * ProtoOASymbolByIdRes and drives price scaling/rounding everywhere.
 */
import { PT, M, toNum } from "./proto.js";
import { accountIdNumber, type CtraderClient } from "./client.js";
import type { Long } from "protobufjs";
import type { Log } from "../logger.js";

/** Aliases for the Dow Jones index CFD, in preference order. */
export const US30_ALIASES = ["US30", "USA30", "DJI30", "DOW30", "DJI", "US30Index", "US30.CASH"];

export interface CtraderSymbolInfo {
  symbolId: number;
  digits: number;
  name: string;
}

export class CtraderSymbols {
  private cache: Map<string, CtraderSymbolInfo> = new Map();
  private loading: Promise<void> | null = null;

  constructor(
    private readonly client: CtraderClient,
    private readonly log: Log,
    /** Env override for the broker's exact symbol name (case-insensitive). */
    private readonly nameOverride?: string
  ) {}

  async get(instrument: string): Promise<CtraderSymbolInfo> {
    const cached = this.cache.get(instrument);
    if (cached) return cached;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
    const info = this.cache.get(instrument);
    if (!info) {
      throw new Error(`cTrader symbol "${instrument}" not found on this broker`);
    }
    return info;
  }

  private async load(): Promise<void> {
    await this.client.onReady();
    const acctId = accountIdNumber(this.client.sessionInfo().accountId);

    const listReq = M.ProtoOASymbolsListReq.encode(
      M.ProtoOASymbolsListReq.fromObject({
        payloadType: PT.SYMBOLS_LIST_REQ,
        ctidTraderAccountId: acctId,
      })
    ).finish();
    const listRes = await this.client.request(PT.SYMBOLS_LIST_REQ, listReq as Uint8Array);
    const decoded = M.ProtoOASymbolsListRes.toObject(M.ProtoOASymbolsListRes.decode(listRes.body), {
      defaults: false,
    }) as { symbol?: Array<{ symbolId?: Long; symbolName?: string; enabled?: boolean }> };

    const light = (decoded.symbol ?? []).map((s) => ({
      symbolId: toNum(s.symbolId),
      name: s.symbolName ?? "",
      enabled: s.enabled !== false,
    }));
    const enabled = light.filter((s) => s.enabled && s.name.length > 0);
    this.log.info({ symbols: enabled.length }, "cTrader symbol list received");

    // Alias order wins; the env override short-circuits everything.
    let chosen: { symbolId: number; name: string } | null = null;
    if (this.nameOverride) {
      const override = this.nameOverride.toUpperCase();
      const hit = enabled.find((s) => s.name.toUpperCase() === override);
      if (hit) chosen = hit;
      else this.log.warn({ override: this.nameOverride }, "CTRADER_US30_SYMBOL not found — falling back to aliases");
    }
    if (!chosen) {
      for (const alias of US30_ALIASES) {
        if (alias === "US30") {
          chosen = enabled.find((s) => s.name.toUpperCase() === alias) ?? null;
        } else {
          chosen = enabled.find((s) => s.name.toUpperCase().startsWith(alias)) ?? null;
        }
        if (chosen) break;
      }
    }
    if (!chosen) {
      this.log.warn({ sample: enabled.slice(0, 20).map((s) => s.name) }, "no US30-like symbol on this broker");
      return;
    }

    // Full symbol record (digits) — the light list doesn't carry it.
    const byIdReq = M.ProtoOASymbolByIdReq.encode(
      M.ProtoOASymbolByIdReq.fromObject({
        payloadType: PT.SYMBOL_BY_ID_REQ,
        ctidTraderAccountId: acctId,
        symbolId: [chosen.symbolId],
      })
    ).finish();
    const byIdRes = await this.client.request(PT.SYMBOL_BY_ID_REQ, byIdReq as Uint8Array);
    const full = M.ProtoOASymbolByIdRes.toObject(M.ProtoOASymbolByIdRes.decode(byIdRes.body), {
      defaults: false,
    }) as { symbol?: Array<{ symbolId?: Long; digits?: number }> };
    const digits = full.symbol?.[0]?.digits ?? 2;

    const info: CtraderSymbolInfo = {
      symbolId: chosen.symbolId,
      digits: Number.isFinite(digits) ? digits : 2,
      name: chosen.name,
    };
    this.cache.set("US30", info);
    this.log.info({ name: info.name, symbolId: info.symbolId, digits: info.digits }, "cTrader US30 resolved");
  }
}
