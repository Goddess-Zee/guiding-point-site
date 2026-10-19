// netlify/functions/audit-scan.js
//
// POST body: { url, orgType, goal }  (orgType/goal optional, improves the Claude analysis)
// Returns: { score, findings: [...], pageSpeedScores, messagingAnalysis, meta: {...} }
//
// This is step 1 of the two-step audit flow: no contact info required.
// Step 2 (submit-lead.js) takes these same results plus the visitor's
// contact info and sends the lead notification email.
//
// Required environment variables:
//   ANTHROPIC_API_KEY  - Anthropic API key
//   PAGESPEED_API_KEY  - (optional) Google PageSpeed Insights API key.

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

  const { url, orgType, goal } = payload;

  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: "url is required" }) };
  }

  let targetUrl;
  try {
    targetUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid URL" }) };
  }

  const findings = [];
  let rawHtml = "";
  let pageTitle = "";
  let pageDescription = "";

  // ---- 1. Fetch and inspect the target site's HTML ----
  try {
    const res = await fetch(targetUrl.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GPC-AuditBot/1.0)" },
      redirect: "follow",
    });
    rawHtml = await res.text();

    const titleMatch = rawHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
    pageTitle = titleMatch ? titleMatch[1].trim() : "";

    const descMatch = rawHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    pageDescription = descMatch ? descMatch[1].trim() : "";

    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(rawHtml);
    const isHttps = targetUrl.protocol === "https:";
    const h1Count = (rawHtml.match(/<h1[^>]*>/gi) || []).length;
    const imgTags = rawHtml.match(/<img[^>]*>/gi) || [];
    const imgsMissingAlt = imgTags.filter((tag) => !/alt=["'][^"']+["']/i.test(tag)).length;
    const hasSchema = /application\/ld\+json/i.test(rawHtml);

    if (!pageTitle) {
      findings.push({ category: "SEO", severity: "high", issue: "Missing or empty <title> tag." });
    } else if (pageTitle.length > 60) {
      findings.push({ category: "SEO", severity: "low", issue: `Title tag is ${pageTitle.length} characters — may get truncated in search results.` });
    }

    if (!pageDescription) {
      findings.push({ category: "SEO", severity: "medium", issue: "Missing meta description." });
    }

    if (!hasViewport) {
      findings.push({ category: "Mobile", severity: "high", issue: "No responsive viewport meta tag — mobile rendering is likely broken." });
    }

    if (!isHttps) {
      findings.push({ category: "Security", severity: "high", issue: "Site is not served over HTTPS." });
    }

    if (h1Count === 0) {
      findings.push({ category: "SEO", severity: "medium", issue: "No <h1> heading found on the page." });
    } else if (h1Count > 1) {
      findings.push({ category: "SEO", severity: "low", issue: `Multiple <h1> tags found (${h1Count}) — should typically be one per page.` });
    }

    if (imgsMissingAlt > 0) {
      findings.push({ category: "Accessibility", severity: "medium", issue: `${imgsMissingAlt} image(s) missing alt text — a Section 508/WCAG compliance gap.` });
    }

    if (!hasSchema) {
      findings.push({ category: "AI Search", severity: "low", issue: "No structured data (schema markup) found — reduces visibility in AI search results and rich snippets." });
    }
  } catch (e) {
    findings.push({ category: "Access", severity: "high", issue: "Could not reach or parse the provided URL. Confirm it is publicly accessible." });
  }

  // ---- 2. PageSpeed Insights ----
  let pageSpeedScores = null;
  try {
    const psiKey = process.env.PAGESPEED_API_KEY;
    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(
      targetUrl.toString()
    )}&strategy=mobile&category=performance&category=accessibility&category=seo&category=best-practices${
      psiKey ? `&key=${psiKey}` : ""
    }`;
    const psiRes = await fetch(psiUrl);
    if (psiRes.ok) {
      const psiData = await psiRes.json();
      const cats = psiData.lighthouseResult?.categories || {};
      pageSpeedScores = {
        performance: cats.performance ? Math.round(cats.performance.score * 100) : null,
        accessibility: cats.accessibility ? Math.round(cats.accessibility.score * 100) : null,
        seo: cats.seo ? Math.round(cats.seo.score * 100) : null,
        bestPractices: cats["best-practices"] ? Math.round(cats["best-practices"].score * 100) : null,
      };

      if (pageSpeedScores.performance !== null && pageSpeedScores.performance < 60) {
        findings.push({ category: "Performance", severity: "high", issue: `Mobile PageSpeed performance score is ${pageSpeedScores.performance}/100.` });
      }
      if (pageSpeedScores.accessibility !== null && pageSpeedScores.accessibility < 80) {
        findings.push({ category: "Accessibility", severity: "medium", issue: `Lighthouse accessibility score is ${pageSpeedScores.accessibility}/100.` });
      }
    }
  } catch (e) {
    // best-effort
  }

  // ---- 3. Claude messaging / audience-clarity analysis ----
  let messagingAnalysis = null;
  try {
    const bodyTextMatch = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);

    if (bodyTextMatch) {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: `You are a nonprofit/public-sector-focused website strategist. Analyze this homepage copy for a visitor whose stated goal is: "${
                goal || "general growth"
              }" and org type: "${orgType || "unspecified"}".

Homepage text:
"""
${bodyTextMatch}
"""

Respond ONLY with valid JSON, no markdown fences, in this exact shape:
{
  "value_prop_clarity": "one sentence assessment",
  "icp_alignment": "one sentence assessment",
  "cta_effectiveness": "one sentence assessment",
  "top_recommendation": "one concrete, specific next step"
}`,
            },
          ],
        }),
      });

      if (anthropicRes.ok) {
        const data = await anthropicRes.json();
        const text = data.content?.find((b) => b.type === "text")?.text || "";
        const cleaned = text.replace(/```json|```/g, "").trim();
        try {
          messagingAnalysis = JSON.parse(cleaned);
        } catch (e) {
          messagingAnalysis = { top_recommendation: text.slice(0, 300) };
        }
      }
    }
  } catch (e) {
    // best-effort
  }

  // ---- 4. Compute overall score ----
  const severityWeight = { high: 15, medium: 8, low: 3 };
  let deductions = findings.reduce((sum, f) => sum + (severityWeight[f.severity] || 5), 0);
  let score = 100 - deductions;
  if (pageSpeedScores?.performance != null) {
    score = Math.round((score + pageSpeedScores.performance) / 2);
  }
  score = Math.max(10, Math.min(100, score));

  const result = {
    score,
    findings,
    pageSpeedScores,
    messagingAnalysis,
    meta: { url: targetUrl.toString(), pageTitle, pageDescription },
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  };
};