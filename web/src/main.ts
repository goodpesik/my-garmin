import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import "primeicons/primeicons.css";
import "./style.css";
import App from "./App.vue";
import { applyTheme } from "./theme";

applyTheme();

createApp(App)
  .use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: ".app-dark" } } })
  .mount("#app");
