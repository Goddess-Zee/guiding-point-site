// netlify/functions/submit-lead.js
//
// POST body: { name, email, orgType, goal, url, result }
//   where `result` is the exact object returned by audit-scan.js
//
// Sends the lead notification email via Microsoft Graph. Returns { ok: true }
// on success so the front end can reveal the full report.
//
// Required environment variables:
//   MS_CLIENT_ID, MS_TENANT_ID, MS_CLIENT_SECRET  - Azure app registration
//   NOTIFY_EMAIL  - where lead notifications are sent (e.g. hello@guidingpointconsults.com)

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

async function getGraphToken() {
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Failed to get Graph token: ${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function sendNotificationEmail({ name, email, orgType, goal, url, result }) {
  const token = await getGraphToken();

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

  const sender = process.env.NOTIFY_EMAIL || "hello@guidingpointconsults.com";

  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: `New Website Audit Lead: ${name || email}`,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: [{ emailAddress: { address: sender } }],
        replyTo: [{ emailAddress: { address: email } }],
      },
    }),
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text();
    throw new Error(`Graph sendMail failed: ${sendRes.status} ${errText}`);
  }
}