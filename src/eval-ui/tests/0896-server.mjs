// Local-only test server: exercise both release states without editing the
// production gate. APIs are fulfilled by the headless test, never production.
import { createServer } from "vite";
const port = Number(process.env.PRIVATE_PUBLISH_TEST_PORT || 4186);
const server = await createServer({
  configFile: "src/eval-ui/vite.config.ts",
  plugins: [{
    name: "0896-test-release-gate", enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/src/lib/hosted-publishing.ts")) {
        return code.replace("= false;", '= new URLSearchParams(location.search).get("gate") === "open";');
      }
    },
  }],
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();
console.log(`Headless verification server on 127.0.0.1:${port}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await server.close(); process.exit(0); });
