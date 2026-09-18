import { inject } from "@vercel/analytics";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { startVersionCheck } from "./services/versionCheck";
import "./styles/global.css";

// Vercel Web Analytics (the snippet in Vercel's docs targets Next.js —
// for a Vue SPA the same package exposes inject()).
inject();

const app = createApp(App);
app.use(createPinia());
app.mount("#app");

// Long-lived tabs keep old bundles after a deploy — auto-reload on focus
// when a newer deployment is live.
startVersionCheck();
