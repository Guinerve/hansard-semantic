// Dev-only server for the relevance-labelling page: `npm run label` → http://0.0.0.0:5293/label.html
import { defineConfig } from "vite";
import { labelServer } from "./scripts/eval/label-server.mjs";

export default defineConfig({
  plugins: [labelServer()],
  server: { host: "0.0.0.0", port: 5293, strictPort: true, open: "/label.html" },
});
