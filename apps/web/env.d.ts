/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MARKET_WS_URL: string;
  readonly VITE_API_HTTP_URL: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
