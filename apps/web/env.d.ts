/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MARKET_WS_URL: string;
  readonly VITE_API_HTTP_URL: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Direct-from-browser Binance endpoints (binanceDirect.ts defaults). */
  readonly VITE_BINANCE_REST_URL?: string;
  readonly VITE_BINANCE_WS_URL?: string;
  /** Geo-block fallback: cloudflare-worker binance-proxy deployment. */
  readonly VITE_BINANCE_PROXY_URL?: string;
  /** oanda-proxy Cloudflare Worker base URL (holds the OANDA token). */
  readonly VITE_OANDA_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
