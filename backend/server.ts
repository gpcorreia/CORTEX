import { createApp } from "./app.js";
import { config } from "./config.js";
let isShuttingDown = false;


const server = createApp().listen(config.port, config.host, () => {
  console.log(`Ecomm: http://${config.host}:${config.port}`);
  console.log(`Inputs: ${config.dataDir} | PID: ${process.pid} | schema: 4 (mesmo produto: branding sem fotografia)`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE"
    ? `A porta ${config.port} já está ocupada. Este servidor NÃO arrancou. Fecha o processo anterior antes de iniciar outro.`
    : error.message);
  process.exitCode = 1;
});

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nReceived ${signal}. Shutting down server...`);

  // Stop accepting connections and close existing ones
  server.close((err) => {
    if (err) {
      console.error("Error closing server:", err);
      process.exitCode = 1;
    } else {
      console.log("Server closed successfully. Port released.");
      process.exitCode = 0;
    }
  });

  // Force shutdown if connections remain open
  setTimeout(() => {
    console.error("Shutdown timeout. Forcing exit.");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
