const FEEDBACK_TO_EMAIL = process.env.FEEDBACK_TO_EMAIL || "aaronsternitzky921@gmail.com";
const FEEDBACK_FROM_EMAIL = process.env.FEEDBACK_FROM_EMAIL || "VEIL Feedback <onboarding@resend.dev>";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = async function feedbackHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return send(res, 400, { error: "Invalid JSON" });
  }

  const message = String(payload?.message || "").trim();
  const type = String(payload?.type || "general").slice(0, 40);
  const path = String(payload?.path || "/").slice(0, 240);
  const model = String(payload?.model || "unknown").slice(0, 120);
  const timestamp = String(payload?.timestamp || new Date().toISOString()).slice(0, 80);

  if (message.length < 4) return send(res, 400, { error: "Feedback message is too short" });
  if (message.length > 2000) return send(res, 400, { error: "Feedback message is too long" });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Missing RESEND_API_KEY. Feedback was not emailed.", { type, path, model, timestamp });
    return send(res, 500, { error: "Feedback email is not configured" });
  }

  const subject = `VEIL feedback: ${type}`;
  const prettyType = escapeHtml(type.charAt(0).toUpperCase() + type.slice(1));
  const safePath = escapeHtml(path);
  const safeModel = escapeHtml(model);
  const safeTimestamp = escapeHtml(timestamp);
  const safeMessage = escapeHtml(message);
  const html = `
    <div style="margin:0;padding:32px;background:#f6dfcf;font-family:Inter,Arial,sans-serif;color:#241109">
      <div style="max-width:680px;margin:0 auto;border:1px solid rgba(255,255,255,.78);border-radius:28px;overflow:hidden;background:linear-gradient(135deg,rgba(255,255,255,.82),rgba(255,235,220,.72));box-shadow:0 28px 80px rgba(104,48,18,.22)">
        <div style="position:relative;padding:30px 32px 28px;background:radial-gradient(circle at 86% 12%,#ff7b1f 0 90px,rgba(255,123,31,.42) 91px 170px,transparent 171px),linear-gradient(135deg,#fffaf5,#ffe6d4)">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="width:48px;height:48px;border-radius:999px;border:1px solid rgba(255,255,255,.9);background:radial-gradient(circle at 32% 28%,#fff 0 9px,transparent 10px),linear-gradient(155deg,#ffb16b,#ff6a14 45%,#d94908);box-shadow:0 12px 30px rgba(255,106,20,.35)"></div>
            <div>
              <div style="font-size:13px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#a45a32">VEIL Feedback</div>
              <h1 style="margin:2px 0 0;font-size:30px;line-height:1.05;color:#1b0a04">New message received</h1>
            </div>
          </div>
        </div>

        <div style="padding:26px 32px 32px">
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px">
            <span style="padding:9px 12px;border-radius:999px;background:#fff8f2;border:1px solid rgba(255,255,255,.9);font-size:12px;font-weight:900;color:#5b2a16">Type: ${prettyType}</span>
            <span style="padding:9px 12px;border-radius:999px;background:#fff8f2;border:1px solid rgba(255,255,255,.9);font-size:12px;font-weight:900;color:#5b2a16">Model: ${safeModel}</span>
          </div>

          <div style="padding:20px;border-radius:22px;background:rgba(255,255,255,.72);border:1px solid rgba(255,255,255,.9);box-shadow:inset 0 1px 0 rgba(255,255,255,.8)">
            <div style="margin-bottom:10px;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#ff6a14">Message</div>
            <div style="white-space:pre-wrap;font-size:17px;line-height:1.6;font-weight:700;color:#321408">${safeMessage}</div>
          </div>

          <div style="margin-top:20px;padding-top:18px;border-top:1px solid rgba(117,67,42,.16);font-size:12px;line-height:1.7;color:#8b6653">
            <div><strong style="color:#5b2a16">Page:</strong> ${safePath}</div>
            <div><strong style="color:#5b2a16">Time:</strong> ${safeTimestamp}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: FEEDBACK_FROM_EMAIL,
      to: FEEDBACK_TO_EMAIL,
      subject,
      html,
      text: `New VEIL feedback\n\nType: ${type}\nPath: ${path}\nModel: ${model}\nTime: ${timestamp}\n\n${message}`
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Resend feedback email failed", detail);
    return send(res, 502, { error: "Could not send feedback email" });
  }

  return send(res, 200, { ok: true });
};
