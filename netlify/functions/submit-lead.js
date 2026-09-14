// netlify/functions/submit-lead.js
//
// POST body: { name, email, orgType, goal, url, result }
//   where `result` is the exact object returned by audit-scan.js
//
// Sends TWO emails via Resend:
//   1. An internal lead notification to NOTIFY_EMAIL (you)
//   2. A branded copy of the full report to the visitor's own email
// Returns { ok: true } on success so the front end can reveal the full report.
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

  let notifyOk = true;
  let visitorOk = true;

  try {
    await sendInternalNotification({ name, email, orgType, goal, url, result });
  } catch (e) {
    console.error("Internal notification failed:", e.message);
    notifyOk = false;
  }

  try {
    await sendVisitorReport({ name, email, url, result });
  } catch (e) {
    console.error("Visitor report email failed:", e.message);
    visitorOk = false;
  }

  // Always let the visitor see their report on-page even if one or both
  // emails failed — but report the actual email status so it's visible
  // in Netlify function logs (and available to the front end if needed).
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, notifyEmailSent: notifyOk, visitorEmailSent: visitorOk }),
  };
};

function buildFindingsHtml(findings) {
  return (findings || [])
    .map((f) => `<li><strong>[${f.severity.toUpperCase()}] ${f.category}:</strong> ${f.issue}</li>`)
    .join("");
}

function buildMessagingHtml(messagingAnalysis) {
  if (!messagingAnalysis) return "";
  return `
    <h3>Messaging Analysis</h3>
    <ul>
      <li><strong>Value prop clarity:</strong> ${messagingAnalysis.value_prop_clarity || "-"}</li>
      <li><strong>Audience fit:</strong> ${messagingAnalysis.icp_alignment || "-"}</li>
      <li><strong>CTA effectiveness:</strong> ${messagingAnalysis.cta_effectiveness || "-"}</li>
      <li><strong>Top recommendation:</strong> ${messagingAnalysis.top_recommendation || "-"}</li>
    </ul>`;
}

async function sendInternalNotification({ name, email, orgType, goal, url, result }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const notifyEmail = (process.env.NOTIFY_EMAIL || "hello@guidingpointconsults.com").trim();

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
    <ul>${buildFindingsHtml(result.findings)}</ul>
    ${buildMessagingHtml(result.messagingAnalysis)}
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
    throw new Error(`Resend send failed (internal): ${res.status} ${errBody}`);
  }
}

async function sendVisitorReport({ name, email, url, result }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const firstName = (name || "").trim().split(" ")[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #021e33;">Your Free Website Audit Report</h2>
      <p>${greeting}</p>
      <p>Thanks for running a free audit on <strong>${url}</strong>. Here's your full report.</p>

      <div style="text-align: center; margin: 1.5rem 0;">
        <div style="display: inline-block; width: 90px; height: 90px; line-height: 90px; border-radius: 50%; background: #021e33; color: #fff; font-size: 1.8rem; font-weight: 700;">
          ${result.score}
        </div>
        <p style="color: #5a5a6e; margin-top: 0.5rem;">out of 100</p>
      </div>

      ${
        result.pageSpeedScores
          ? `<p><strong>PageSpeed:</strong> Performance ${result.pageSpeedScores.performance ?? "-"}, Accessibility ${
              result.pageSpeedScores.accessibility ?? "-"
            }, SEO ${result.pageSpeedScores.seo ?? "-"}, Best Practices ${result.pageSpeedScores.bestPractices ?? "-"}</p>`
          : ""
      }

      <h3 style="color: #021e33;">Findings</h3>
      <ul>${buildFindingsHtml(result.findings)}</ul>

      ${buildMessagingHtml(result.messagingAnalysis)}

      <div style="text-align: center; margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #eee;">
        <p style="color: #5a5a6e;">Want help acting on these findings? Guiding Point specializes in accessible, public-sector-ready websites for nonprofits and subcontractors.</p>
        <a href="https://guidingpointconsults.com/contact" style="display: inline-block; background: #751312; color: #fff; text-decoration: none; padding: 0.85rem 1.75rem; border-radius: 8px; font-weight: 700;">Book a Free Strategy Call</a>
      </div>

      <p style="color: #9a9aa8; font-size: 0.8rem; margin-top: 2rem;">
        You're receiving this because you ran a free website audit at guidingpointconsults.com/website-audit.
      </p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Guiding Point Consulting <hello@guidingpointconsults.com>`,
      to: [email],
      subject: `Your Free Website Audit Results — Score: ${result.score}/100`,
      html: htmlBody,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend send failed (visitor): ${res.status} ${errBody}`);
  }
}