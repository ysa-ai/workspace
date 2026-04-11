const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — skipping email to ${to}: ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error: ${res.status} ${body}`);
  }
}
