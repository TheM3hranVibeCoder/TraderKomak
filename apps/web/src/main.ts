import { inject } from "@vercel/analytics";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/global.css";

// Vercel Web Analytics (the snippet in Vercel's docs targets Next.js —
// for a Vue SPA the same package exposes inject()).
inject();

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
