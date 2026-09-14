// netlify/functions/submit-lead.js
//
// POST body: { name, email, orgType, goal, url, result }
//   where `result` is the exact object returned by audit-scan.js
//
// Sends the lead notification email via Resend. Returns { ok: true }
// on success so the front end can reveal the full report.
//
// Required environment variables:
//   RESEND_API_KEY  - Resend API key
//   NOTIFY_EMAIL    - where lead notifications are sent (e.g. hello@guidingpointconsults.com)

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { name, email, orgType, goal, url, result } = payload;

  if (!email || !result) {
    return { statusCode: 400, body: JSON.stringify({ error: "email and result are required" }) };
  }

  try {
    await sendNotificationEmail({ name, email, orgType, goal, url, result });
  } catch (e) {
    console.error("Email notification failed:", e.message);
    // Still let the visitor see their report even if the email failed —
    // but flag it so the response can be inspected in Netlify function logs.
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, emailSent: false }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, emailSent: true }),
  };
};

async function sendNotificationEmail({ name, email, orgType, goal, url, result }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const notifyEmail = (process.env.NOTIFY_EMAIL || "hello@guidingpointconsults.com").trim();

  const findingsHtml = (result.findings || [])
    .map((f) => `<li><strong>[${f.severity.toUpperCase()}] ${f.category}:</strong> ${f.issue}</li>`)
    .join("");

  const messagingHtml = result.messagingAnalysis
    ? `
    <h3>Messaging Analysis</h3>
    <ul>
      <li><strong>Value prop clarity:</strong> ${result.messagingAnalysis.value_prop_clarity || "-"}</li>
      <li><strong>Audience fit:</strong> ${result.messagingAnalysis.icp_alignment || "-"}</li>
      <li><strong>CTA effectiveness:</strong> ${result.messagingAnalysis.cta_effectiveness || "-"}</li>
      <li><strong>Top recommendation:</strong> ${result.messagingAnalysis.top_recommendation || "-"}</li>
    </ul>`
    : "";

  const htmlBody = `
    <h2>New Website Audit Submission</h2>
    <p><strong>Name:</strong> ${name || "-"}<br/>
    <strong>Email:</strong> ${email}<br/>
    <strong>Org type:</strong> ${orgType || "-"}<br/>
    <strong>Goal:</strong> ${goal || "-"}<br/>
    <strong>Audited URL:</strong> ${url}</p>
    <h3>Score: ${result.score}/100</h3>
    ${
      result.pageSpeedScores
        ? `<p>PageSpeed — Performance: ${result.pageSpeedScores.performance ?? "-"}, Accessibility: ${
            result.pageSpeedScores.accessibility ?? "-"
          }, SEO: ${result.pageSpeedScores.seo ?? "-"}, Best Practices: ${result.pageSpeedScores.bestPractices ?? "-"}</p>`
        : ""
    }
    <h3>Findings</h3>
    <ul>${findingsHtml}</ul>
    ${messagingHtml}
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `GPC Audit Tool <notifications@guidingpointconsults.com>`,
      to: [notifyEmail],
      reply_to: email,
      subject: `New Website Audit Lead: ${name || email}`,
      html: htmlBody,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${errBody}`);
  }
}