// Branded magic-link email HTML, parameterized by product. Table-based with inline
// styles — the only layout that renders consistently across email clients (Gmail,
// Apple Mail, Outlook); flexbox/grid and <style> blocks are unreliable there. Lifted
// from Metron's web/lib/auth.ts::magicLinkEmail, generalized so one shared auth
// service can brand the same email correctly for every product it serves.

export type Product = "metron" | "vires";

const PRODUCT_META: Record<Product, { name: string; logoUrl: string }> = {
  metron: { name: "Metron", logoUrl: "https://metron.nousergon.ai/favicon-192.png" },
  vires: { name: "Vires", logoUrl: "https://fitness.nousergon.ai/favicon-192.png" },
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function magicLinkEmail(url: string, product: Product): string {
  const { name, logoUrl } = PRODUCT_META[product];
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
        <tr><td style="padding:32px 32px 0 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;"><img src="${logoUrl}" width="40" height="40" alt="${name}" style="display:block;border-radius:8px;" /></td>
            <td style="vertical-align:middle;padding-left:12px;font-family:${FONT};font-size:18px;font-weight:600;color:#18181b;letter-spacing:-0.01em;">${name}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 32px 0 32px;font-family:${FONT};">
          <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#18181b;">Sign in to ${name}</h1>
          <p style="margin:0;font-size:15px;line-height:22px;color:#52525b;">Click the button below to sign in. This link expires shortly and can be used once.</p>
        </td></tr>
        <tr><td style="padding:24px 32px 4px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:8px;background:#18181b;"><a href="${url}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Sign in</a></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:8px 32px 0 32px;font-family:${FONT};">
          <p style="margin:0;font-size:13px;line-height:20px;color:#71717a;">Or paste this link into your browser:<br/><a href="${url}" style="color:#0284c7;word-break:break-all;">${url}</a></p>
        </td></tr>
        <tr><td style="padding:24px 32px 32px 32px;font-family:${FONT};">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 16px 0;" />
          <p style="margin:0;font-size:12px;line-height:18px;color:#a1a1aa;">You're receiving this because a sign-in link was requested for this address. If that wasn't you, you can safely ignore this email &mdash; no action will be taken.</p>
          <p style="margin:12px 0 0 0;font-size:12px;color:#a1a1aa;">Nous Ergon &middot; ${name}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
