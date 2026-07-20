// Thin Node HTTP entrypoint — no framework needed. better-auth ships a first-class
// Node adapter (better-auth/node's toNodeHandler) that wraps its Web-standard
// Request/Response handler for plain node:http.
//
// The one thing that adapter doesn't do is browser CORS: Metron (metron.nousergon.ai)
// and Vires (vires.nousergon.ai) both call this service cross-origin from client-side
// JS, so preflight (OPTIONS) and Access-Control-Allow-* headers have to be handled at
// this layer. `trustedOrigins` in auth.ts governs better-auth's own origin/CSRF check;
// this CORS layer governs whether the browser is even allowed to read the response —
// both need the same allowlist, kept in one place (AUTH_TRUSTED_ORIGINS) to avoid the
// two drifting apart.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { auth } from "./auth.js";
import { toNodeHandler } from "better-auth/node";
import { renderConfirmPage } from "./confirm-page.js";
import type { Product } from "./magic-link-templates.js";

const PORT = Number(process.env.PORT ?? 4100);

export function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Only ever forward the confirm page's button to OUR OWN verify endpoint — without
// this, `/confirm?verify=<attacker-url>` would be an open redirect (the page would
// legitimately say "Continue to Vires" while sending the click somewhere else
// entirely). No cookie-leak risk either way (browsers scope cookie attachment to the
// request's target origin, not the calling page's), but the phishing/social-engineering
// angle alone is worth closing off.
function validatedVerifyUrl(raw: string | null): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const authOrigin = new URL(process.env.AUTH_BASE_URL ?? "http://localhost:4100").origin;
  if (parsed.origin !== authOrigin || parsed.pathname !== "/api/auth/magic-link/verify") {
    return null;
  }
  return raw;
}

// Exported so tests can build a request listener against an injected `auth` instance
// (e.g. one wired to a throwaway sqlite file) without binding a real network port.
export function createRequestListener(
  authInstance: typeof auth = auth,
): (req: IncomingMessage, res: ServerResponse) => void {
  const handler = toNodeHandler(authInstance);
  return (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/confirm")) {
      const parsed = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const verifyUrl = validatedVerifyUrl(parsed.searchParams.get("verify"));
      const productParam = parsed.searchParams.get("product");
      const product: Product = productParam === "vires" ? "vires" : "metron";
      if (!verifyUrl) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing or invalid sign-in link.");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderConfirmPage(verifyUrl, product));
      return;
    }
    const origin = req.headers.origin;
    if (origin && allowedOrigins().has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.writeHead(204);
      res.end();
      return;
    }
    handler(req, res);
  };
}

// Only bind a real port when this module is the process entrypoint (`node dist/server.js`
// or `tsx watch src/server.ts`) — not when a test imports it for its exports.
const isEntrypoint =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  const server = createServer(createRequestListener());
  server.listen(PORT, () => {
    console.log(`nousergon-auth listening on :${PORT}`);
  });
}
