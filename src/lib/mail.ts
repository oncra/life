// Transactional mail through Brevo's HTTP API (the oracle host's cloud provider blocks outbound SMTP on 465,
// and an HTTP API needs no SMTP at all). Only sign-in codes go out this way.
export async function sendMail(m: { to: string; subject: string; text: string }) {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM ?? "life@oncra.org";
  const name = process.env.MAIL_FROM_NAME ?? "Life oracle";
  if (!key) {
    if (process.env.NODE_ENV !== "production") { console.log(`[mail to ${m.to}] ${m.subject}\n${m.text}`); return; }
    throw new Error("BREVO_API_KEY is not set");
  }
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: from, name }, to: [{ email: m.to }], subject: m.subject, textContent: m.text }),
  });
  if (!r.ok) throw new Error(`mail not sent: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
