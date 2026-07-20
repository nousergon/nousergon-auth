// Interstitial "confirm sign-in" page — the emailed link points HERE now, not
// directly at better-auth's magic-link verify endpoint. Verify is a plain GET that
// atomically consumes the one-time token on ANY request (better-auth's
// `allowedAttempts` option is a documented no-op — see the warning in
// node_modules/better-auth/dist/plugins/magic-link/index.mjs), which is fatal for
// magic links: a bare navigable GET gets silently pre-fetched by mail-client link
// scanners and cross-device sync/notification previews, burning the token before the
// human's real click lands. Root-caused live 2026-07-20 (vires sign-in incident): the
// same token was being consumed by a second, non-human hit within seconds on every
// single attempt, regardless of device.
//
// Standard mitigation for this exact GET-triggers-a-state-change problem (used by
// Slack/Linear/Notion et al. for the same reason): the link opens this page, which
// does NOT touch the verify endpoint on load — only an explicit user click does.
//
// That click is a PLAIN NAVIGATION (a real <a href>), not a script-initiated fetch()
// — deliberately. better-auth's verify endpoint 302s to `callbackURL` on a different
// origin (e.g. vires.nousergon.ai from auth.nousergon.ai), and fetch()'s CORS
// enforcement applies to that redirect hop even under `redirect:'follow'`; the
// product's origin has no reason to send CORS headers permitting the auth service to
// read its response, so a fetch-based version throws there (shipped and reverted the
// same day — nousergon-auth#29's follow-up). A normal browser navigation follows a
// cross-origin redirect exactly like clicking any other link always has, no CORS
// involved — so this is both simpler and the actually-correct mechanism.
// Prefetchers/scanners still can't trigger it: they fetch this page's own HTML, they
// don't parse-and-follow links found inside it, so the verify URL sitting in an
// unclicked <a href> is inert until a real click navigates to it.

import { PRODUCT_META, type Product } from "./magic-link-templates.js";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderConfirmPage(verifyUrl: string, product: Product): string {
  const { name, logoUrl } = PRODUCT_META[product];
  const href = escapeHtmlAttr(verifyUrl);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sign in to ${name}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};">
  <div style="max-width:420px;margin:64px auto;padding:32px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;text-align:center;">
    <img src="${logoUrl}" width="40" height="40" alt="${name}" style="border-radius:8px;margin-bottom:16px;" />
    <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#18181b;">Sign in to ${name}</h1>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:#52525b;">
      Confirm it was you to finish signing in.
    </p>
    <a href="${href}" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#fff;background:#18181b;text-decoration:none;border-radius:8px;">
      Continue to ${name}
    </a>
  </div>
</body>
</html>`;
}
