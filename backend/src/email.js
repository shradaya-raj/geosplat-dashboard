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

export async function sendProjectApprovalEmail({ project, models = [], uploadedBy, reviewUrl, approveAllUrl, rejectAllUrl }) {
  const projectName = project?.name || models[0]?.projectName || "Uploaded project";
  const fileCount = models.length;
  const totalBytes = models.reduce((sum, model) => sum + Number(model.size || 0), 0);
  const subject = `Review project upload: ${projectName}`;
  const text = [
    `A project upload is waiting for approval.`,
    ``,
    `Project: ${projectName}`,
    `Uploader: ${uploadedBy || models[0]?.ownerEmail || "unknown"}`,
    `Files: ${fileCount}`,
    `Total size: ${totalBytes} bytes`,
    ``,
    `Review/select files: ${reviewUrl}`,
    `Approve all: ${approveAllUrl}`,
    `Reject all: ${rejectAllUrl}`
  ].join("\n");

  const fileRows = models.map((model) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e4ece6;">${escapeHtml(model.name || model.filename || model.id)}</td>
      <td style="padding:8px;border-bottom:1px solid #e4ece6;">${escapeHtml(model.assetTypeLabel || model.assetType || "File")}</td>
      <td style="padding:8px;border-bottom:1px solid #e4ece6;text-align:right;">${escapeHtml(model.size || "unknown")} bytes</td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #17201a;">
      <h2>Project upload approval request</h2>
      <p>A project has been uploaded and is waiting for review.</p>
      <table cellpadding="6" cellspacing="0" style="border-collapse: collapse;margin-bottom:14px;">
        <tr><td><strong>Project</strong></td><td>${escapeHtml(projectName)}</td></tr>
        <tr><td><strong>Uploader</strong></td><td>${escapeHtml(uploadedBy || models[0]?.ownerEmail || "unknown")}</td></tr>
        <tr><td><strong>Files</strong></td><td>${fileCount}</td></tr>
      </table>
      <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;width:100%;max-width:760px;margin:16px 0;">
        <thead>
          <tr>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #d8e3dc;">File</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #d8e3dc;">Type</th>
            <th style="padding:8px;text-align:right;border-bottom:2px solid #d8e3dc;">Size</th>
          </tr>
        </thead>
        <tbody>${fileRows}</tbody>
      </table>
      <p>
        <a href="${reviewUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#56d276;color:#0d1a12;text-decoration:none;font-weight:700;">Review selected files</a>
        &nbsp;
        <a href="${approveAllUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#dfffd4;color:#0d1a12;text-decoration:none;font-weight:700;">Approve all</a>
        &nbsp;
        <a href="${rejectAllUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#ffe1dc;color:#7a2318;text-decoration:none;font-weight:700;">Reject all</a>
      </p>
      <p style="color:#65736a;font-size:13px;">If the buttons do not work, copy the review link into your browser.</p>
    </div>
  `;

  if (!isEmailConfigured()) {
    console.warn("RESEND_API_KEY is not configured. Project approval email was not sent.");
    console.warn(`Project review link for ${projectName}: ${reviewUrl}`);
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
    throw new Error(`Project approval email failed: ${response.status} ${detail}`);
  }

  return { sent: true };
}
