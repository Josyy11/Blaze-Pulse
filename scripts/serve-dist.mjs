import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { handlePulseRequest } from "./pulse-service.mjs";

const root = new URL("../dist/", import.meta.url).pathname.slice(1);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/pulse") {
    void handlePulseRequest(request, response);
    return;
  }

  const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  response.setHeader("cache-control", "no-store, max-age=0");
  response.setHeader("content-type", types[extname(filePath)] || "application/octet-stream");
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Serving dist at http://${host}:${port}`);
});
