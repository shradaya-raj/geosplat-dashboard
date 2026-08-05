import { config } from "./config.js";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function isEmailConfigured() {
  return Boolean(config.email.resendApiKey);
}

export async function sendApprovalEmail({ model, uploadedBy, approveUrl, rejectUrl }) {
  const subject = `Approve Gaussian model: ${model.name}`;
  const text = [
    `A Gaussian model is waiting for approval.`,
    ``,
    `Model: ${model.name}`,
    `Uploader: ${uploadedBy || model.ownerEmail || "unknown"}`,
    `Size: ${model.size || "unknown"} bytes`,
    ``,
    `Approve: ${approveUrl}`,
    `Reject: ${rejectUrl}`
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #17201a;">
      <h2>Gaussian model approval request</h2>
      <p>A model has been uploaded and is waiting for review.</p>
      <table cellpadding="6" cellspacing="0" style="border-collapse: collapse;">
        <tr><td><strong>Model</strong></td><td>${escapeHtml(model.name)}</td></tr>
        <tr><td><strong>Uploader</strong></td><td>${escapeHtml(uploadedBy || model.ownerEmail || "unknown")}</td></tr>
        <tr><td><strong>Size</strong></td><td>${escapeHtml(model.size || "unknown")} bytes</td></tr>
      </table>
      <p>
        <a href="${approveUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#56d276;color:#0d1a12;text-decoration:none;font-weight:700;">Approve model</a>
        &nbsp;
        <a href="${rejectUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#ffe1dc;color:#7a2318;text-decoration:none;font-weight:700;">Reject</a>
      </p>
      <p style="color:#65736a;font-size:13px;">If the buttons do not work, copy the approval link into your browser.</p>
    </div>
  `;

  if (!isEmailConfigured()) {
    console.warn("RESEND_API_KEY is not configured. Approval email was not sent.");
    console.warn(`Approval link for ${model.name}: ${approveUrl}`);
    return { sent: false, reason: "email-not-configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.email.from,
      to: [config.approvalEmail],
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Approval email failed: ${response.status} ${detail}`);
  }

  return { sent: true };
}
