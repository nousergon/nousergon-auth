// Minimal transactional email sender for magic links. Lifted from Metron's
// web/lib/email.ts unchanged (same Resend account, same nousergon.ai sending domain) —
// this service is now the sole place magic-link email goes out for every product.
//
// Fails loud: a missing credential or a send error throws, so a magic-link request
// surfaces a real error rather than a link that silently never arrives.

import { Resend } from "resend";

let cached: Resend | null = null;

function client(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("Email not configured — set RESEND_API_KEY to send magic links.");
  }
  cached = new Resend(key);
  return cached;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const from = process.env.EMAIL_SENDER;
  if (!from) {
    throw new Error("Email not configured — set EMAIL_SENDER (a Resend-verified sender, e.g. no-reply@nousergon.ai).");
  }
  const { error } = await client().emails.send({ from, to, subject, html, text });
  if (error) {
    // Resend returns a structured error object instead of throwing — re-raise so the
    // caller (the magic-link send path) fails loud.
    throw new Error(`Failed to send email via Resend: ${error.message}`);
  }
}
