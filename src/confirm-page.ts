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
// does NOT touch the verify endpoint on load — only an explicit user click does, via
// a script-initiated fetch. Prefetchers/scanners fetch inert HTML; they don't execute
// JS button clicks.

import { PRODUCT_META, type Product } from "./magic-link-templates.js";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderConfirmPage(verifyUrl: string, product: Product): string {
  const { name, logoUrl } = PRODUCT_META[product];
  // Handed to the client via a JSON <script> block, read with .textContent — never
  // interpolated into HTML/JS source directly, so there's no attribute- or
  // script-context escaping footgun for a value that's ultimately a query param.
  // The `<` escape additionally guards against a literal `</script>` in the URL
  // breaking out of the block.
  const payload = JSON.stringify({ verifyUrl }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sign in to ${name}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};">
  <script type="application/json" id="confirm-data">${payload}</script>
  <div style="max-width:420px;margin:64px auto;padding:32px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;text-align:center;">
    <img src="${logoUrl}" width="40" height="40" alt="${name}" style="border-radius:8px;margin-bottom:16px;" />
    <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#18181b;">Sign in to ${name}</h1>
    <p id="confirm-status" style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:#52525b;">
      Confirm it was you to finish signing in.
    </p>
    <button id="confirm-btn" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#fff;background:#18181b;border:none;border-radius:8px;cursor:pointer;">
      Continue to ${name}
    </button>
  </div>
  <script>
    (function () {
      var data = JSON.parse(document.getElementById('confirm-data').textContent);
      var btn = document.getElementById('confirm-btn');
      var status = document.getElementById('confirm-status');
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Signing in\\u2026';
        fetch(data.verifyUrl, { credentials: 'include', redirect: 'follow' })
          .then(function (res) { window.location.href = res.url; })
          .catch(function () {
            status.textContent = 'Something went wrong. Please try again or request a new link.';
            btn.disabled = false;
            btn.textContent = 'Continue to ${name}';
          });
      });
    })();
  </script>
</body>
</html>`;
}
