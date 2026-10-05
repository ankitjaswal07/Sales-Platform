/**
 * Custom server entry point.
 *
 * `next start` is the right way to run LeadForge on a VPS or in Docker, but
 * some hosting panels (cPanel's "Setup Node.js App", Plesk, Phusion Passenger)
 * need a JavaScript file they can launch and supervise themselves. This is that
 * file — set it as the application's startup file.
 *
 * Passenger and friends intercept `server.listen()` and hand the process a
 * socket through the environment, so we simply listen on `PORT` (or 3000) and
 * let the supervisor take over. Nothing here changes how Next behaves.
 *
 * Run it with the production build already created:
 *   npm run build && node server.js
 */
const { createServer } = require("node:http");
const next = require("next");

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME_BIND || "0.0.0.0";

const app = next({ dev: process.env.NODE_ENV !== "production", dir: __dirname });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((request, response) => {
      handle(request, response).catch((error) => {
        console.error(JSON.stringify({ level: "error", scope: "server", message: String(error) }));
        response.statusCode = 500;
        response.end("Internal Server Error");
      });
    }).listen(port, hostname, () => {
      console.log(
        JSON.stringify({
          level: "info",
          scope: "server",
          message: "LeadForge listening",
          hostname,
          port,
          mode: process.env.NODE_ENV ?? "development",
        }),
      );
    });
  })
  .catch((error) => {
    console.error(JSON.stringify({ level: "error", scope: "server", message: "Failed to start", error: String(error) }));
    process.exit(1);
  });

// Supervisors send SIGTERM on deploy/restart; exit cleanly rather than hanging.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: "info", scope: "server", message: `Received ${signal}, shutting down` }));
    process.exit(0);
  });
}
