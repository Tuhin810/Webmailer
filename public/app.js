// DOM Elements
const form = document.querySelector("#mailer-form");
const sendButton = document.querySelector("#send-button");
const terminal = document.querySelector("#terminal");
const clearTerminalBtn = document.querySelector("#clear-terminal-btn");
const progressContainer = document.querySelector("#progress-container");
const progressBarFill = document.querySelector("#progress-bar-fill");
const progressText = document.querySelector("#progress-text");
const statRecipients = document.querySelector("#stat-recipients");
const statMode = document.querySelector("#stat-mode");

// Profile Badge & Config Modal Elements
const profileBadgeBtn = document.querySelector("#profile-badge-btn");
const profileDisplayName = document.querySelector("#profile-display-name");
const avatarInitials = document.querySelector("#avatar-initials");
const configModal = document.querySelector("#config-modal");
const cfgDelayInput = document.querySelector("#cfg-delay");
const cfgCancelBtn = document.querySelector("#cfg-cancel-btn");
const googleAccountStatus = document.querySelector("#google-account-status");
const googleConnectBtn = document.querySelector("#google-connect-btn");
const googleDisconnectBtn = document.querySelector("#google-disconnect-btn");

// Form Inputs & Recipients
const csvInput = document.querySelector("#csv-input");
const recipientsList = document.querySelector("#recipients-list");
const subjectInput = document.querySelector("#subject-input");
const messageInput = document.querySelector("#message-input");
const messageVisual = document.querySelector("#message-visual");
const modeNormalBtn = document.querySelector("#mode-normal-btn");
const modeHtmlBtn = document.querySelector("#mode-html-btn");
const richToolbar = document.querySelector("#rich-toolbar");
const pdfInput = document.querySelector("#pdf-input");
const attachmentsContainer = document.querySelector("#attachments-container");
const broadcastCheckbox = document.querySelector("#broadcast-checkbox");
const discardBtn = document.querySelector("#discard-btn");

// Variable Menu Elements
const variableTriggerBtn = document.querySelector("#variable-trigger-btn");
const variableMenu = document.querySelector("#variable-menu");
const varTooltip = document.querySelector("#var-tooltip");

// State
let loadedRecipients = [];
let currentAttachment = null;
let activeConfig = { gmail: "", delay_ms: 750 };
let activeInput = messageVisual;
let editorMode = "normal"; // "normal" or "html"
let selectedAttachmentFormat = "pdf"; // "pdf", "image", "docx"

// Helper function to sanitize Subject string into safe filename
function getSanitizedSubjectFilename(ext = "pdf") {
  const rawSubject = (subjectInput ? subjectInput.value : "").trim();
  if (!rawSubject) return `Attachment.${ext}`;
  const cleanName = rawSubject.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
  return `${cleanName}.${ext}`;
}

// Dynamically update attachment filename when Subject changes
function updateAttachmentFilenameFromSubject() {
  const ext = currentAttachment?.format || selectedAttachmentFormat || "pdf";
  const filename = getSanitizedSubjectFilename(ext);

  const previewEl = document.querySelector("#attachment-filename-preview");
  if (previewEl) previewEl.textContent = filename;

  if (currentAttachment && currentAttachment.isSubjectSynced) {
    currentAttachment.name = filename;
    const nameSpan = document.querySelector("#current-attachment-filename-span");
    if (nameSpan) nameSpan.textContent = filename;
  }
}

// Log function with timestamp and formatting
function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.className = "log-line";

  let prefix = "";
  if (type === "sys") prefix = `<span class="log-sys">[SYS]</span> `;
  else if (type === "csv") prefix = `<span class="log-csv">[CSV]</span> `;
  else if (type === "sent") prefix = `<span class="log-sent">[SENT]</span> `;
  else if (type === "dry") prefix = `<span class="log-dry">[DRY-RUN]</span> `;
  else if (type === "error") prefix = `<span class="log-error">[ERROR]</span> `;
  else prefix = `<span class="log-info">[INFO]</span> `;

  line.innerHTML = `<span class="log-time">[${time}]</span> ${prefix}${escapeHtml(msg)}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 1. CONFIGURATION MANAGEMENT (Browser localStorage)
async function loadConfig() {
  const delay_ms = localStorage.getItem("mailer_delay") || "750";
  cfgDelayInput.value = delay_ms;
  try {
    const auth = await fetch("/api/auth/status").then((res) => res.json());
    const gmail = auth.email;
    if (gmail) {
    const parts = gmail.split("@")[0];
    const displayName = parts.charAt(0).toUpperCase() + parts.slice(1);
    profileDisplayName.textContent = `${displayName} (me)`;
    avatarInitials.textContent = parts.slice(0, 2).toUpperCase();
      googleAccountStatus.textContent = `Connected as ${gmail}`;
      googleConnectBtn.classList.add("hidden");
      googleDisconnectBtn.classList.remove("hidden");
      log(`Connected Google sender profile (${gmail}).`, "sys");
  } else {
      googleAccountStatus.textContent = "No Google account connected.";
      googleConnectBtn.classList.remove("hidden");
      googleDisconnectBtn.classList.add("hidden");
      log(`No Google sender profile connected. Click "From" to sign in.`, "sys");
    }
  } catch {
    googleAccountStatus.textContent = "Could not check Google connection.";
  }
}

profileBadgeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  configModal.classList.toggle("hidden");
});

cfgCancelBtn.addEventListener("click", () => {
  configModal.classList.add("hidden");
});

cfgDelayInput.addEventListener("change", () => {
  localStorage.setItem("mailer_delay", cfgDelayInput.value || "750");
});

googleConnectBtn.addEventListener("click", () => { window.location.assign("/api/auth/google/login"); });
googleDisconnectBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  configModal.classList.add("hidden");
  await loadConfig();
});

document.addEventListener("click", (e) => {
  if (!configModal.contains(e.target) && e.target !== profileBadgeBtn && !profileBadgeBtn.contains(e.target)) {
    configModal.classList.add("hidden");
  }
  if (!variableMenu.contains(e.target) && e.target !== variableTriggerBtn && !variableTriggerBtn.contains(e.target)) {
    variableMenu.classList.add("hidden");
  }
});

// 2. CSV PARSING & RECIPIENT CHIPS
function parseCsv(csvText) {
  const rows = csvText.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const values = [];
    let val = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i++; }
      else if (line[i] === '"') quoted = !quoted;
      else if (line[i] === "," && !quoted) { values.push(val.trim()); val = ""; }
      else val += line[i];
    }
    values.push(val.trim());
    return values;
  });

  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.toLowerCase());
  const emailIdx = headers.indexOf("email");
  const nameIdx = headers.indexOf("name");

  if (emailIdx === -1) throw new Error("CSV file must contain an 'email' column header.");

  return rows
    .map((row) => ({
      email: row[emailIdx] || "",
      name: nameIdx !== -1 ? row[nameIdx] || "" : "",
    }))
    .filter((r) => r.email && r.email.includes("@"));
}

csvInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    loadedRecipients = parseCsv(text);
    renderRecipientsUI(file.name);
    statRecipients.textContent = `Recipients: ${loadedRecipients.length}`;
    log(`CSV file "${file.name}" loaded with ${loadedRecipients.length} valid recipient(s).`, "csv");
  } catch (err) {
    log(`CSV parse error: ${err.message}`, "error");
    alert(`CSV Error: ${err.message}`);
  }
});

function renderRecipientsUI(filename = "recipients.csv") {
  recipientsList.innerHTML = "";
  const toActionsContainer = document.querySelector(".to-actions");

  if (loadedRecipients.length === 0) {
    if (toActionsContainer) toActionsContainer.style.display = "inline-flex";
    return;
  }

  // Hide "Choose CSV" button after CSV is uploaded
  if (toActionsContainer) toActionsContainer.style.display = "none";

  const count = loadedRecipients.length;
  const labelText = count === 1 ? "1 email" : `${count} emails`;

  // 1. Mobile summary badge (visible on mobile screens)
  const mobileCountChip = document.createElement("div");
  mobileCountChip.className = "recipient-chip main-count-chip";
  mobileCountChip.innerHTML = `
    <span class="chip-avatar-num">${count}</span>
    <span class="chip-text">${labelText}</span>
    <button type="button" class="chip-remove clear-all-btn" title="Remove CSV & clear all">✕</button>
  `;
  recipientsList.appendChild(mobileCountChip);

  // 2. Desktop view: Render 2 individual emails from list + remaining count badge
  const maxVisibleDesktop = 2;
  const visibleRecipients = loadedRecipients.slice(0, maxVisibleDesktop);
  const remainingCount = count - maxVisibleDesktop;

  visibleRecipients.forEach((rec, idx) => {
    const initials = rec.name
      ? rec.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
      : rec.email.slice(0, 2).toUpperCase();

    const chip = document.createElement("div");
    chip.className = "recipient-chip individual-chip";
    chip.innerHTML = `
      <span class="chip-avatar">${escapeHtml(initials)}</span>
      <span class="chip-text">${escapeHtml(rec.name || rec.email)}</span>
      <button type="button" class="chip-remove remove-single-btn" data-idx="${idx}" title="Remove recipient">✕</button>
    `;
    recipientsList.appendChild(chip);
  });

  if (remainingCount > 0) {
    const remainingText = `+${remainingCount} emails`;
    const moreChip = document.createElement("div");
    moreChip.className = "recipient-chip individual-chip summary-chip";
    moreChip.innerHTML = `
      <span class="chip-avatar-num">+${remainingCount}</span>
      <span class="chip-text">${remainingText}</span>
      <button type="button" class="chip-remove clear-all-btn" title="Remove CSV & clear all">✕</button>
    `;
    recipientsList.appendChild(moreChip);
  }

  // Event listener for removing individual recipient
  recipientsList.querySelectorAll(".remove-single-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.getAttribute("data-idx"));
      loadedRecipients.splice(idx, 1);
      renderRecipientsUI(filename);
      if (statRecipients) statRecipients.textContent = `Recipients: ${loadedRecipients.length}`;
    });
  });

  // Event listener for clearing all CSV recipients
  recipientsList.querySelectorAll(".clear-all-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      loadedRecipients = [];
      const csvInput = document.querySelector("#csv-input");
      if (csvInput) csvInput.value = "";
      renderRecipientsUI();
      if (statRecipients) statRecipients.textContent = "Recipients: 0";
      log("Cleared loaded CSV recipients.", "info");
    });
  });
}

// 3. ATTACHMENT HANDLING (PDF, PNG, JPG & DOCX + HTML Converter)
function handleFileSelect(file) {
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  let format = "pdf";
  if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    format = "png";
  } else if (ext === "docx" || ext === "doc" || file.type.includes("wordprocessing")) {
    format = "docx";
  }

  const reader = new FileReader();
  reader.onload = () => {
    currentAttachment = {
      name: file.name,
      mimeType: file.type || (format === "png" ? "image/png" : (format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf")),
      base64: reader.result.split(",")[1],
      format: format,
      isSubjectSynced: false
    };
    renderAttachmentCard(file.name, format);
    log(`Attachment "${file.name}" loaded (${(file.size / 1024).toFixed(1)} KB).`, "info");
  };
  reader.readAsDataURL(file);
}

const attachmentFileInput = document.querySelector("#attachment-file-input");
if (attachmentFileInput) {
  attachmentFileInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
}

if (pdfInput) {
  pdfInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
}

// Drag & drop onto attachments section
attachmentsContainer.addEventListener("dragover", (e) => {
  e.preventDefault();
  const dropzone = document.querySelector("#attachment-dropzone");
  if (dropzone) dropzone.classList.add("dragover");
});

attachmentsContainer.addEventListener("dragleave", () => {
  const dropzone = document.querySelector("#attachment-dropzone");
  if (dropzone) dropzone.classList.remove("dragover");
});

attachmentsContainer.addEventListener("drop", (e) => {
  e.preventDefault();
  const dropzone = document.querySelector("#attachment-dropzone");
  if (dropzone) dropzone.classList.remove("dragover");
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

function renderEmptyDropzone() {
  attachmentsContainer.innerHTML = `
    <div class="attachment-options-grid" id="attachment-options-grid">
      <label class="attachment-upload-box" id="attachment-dropzone" title="Click or drag & drop a PDF, image, or document file">
        <input id="attachment-file-input" type="file" accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.doc" hidden />
        <div class="upload-box-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </div>
        <div class="upload-box-text">
          <span class="upload-main-text">Upload File</span>
          <span class="upload-sub-text">PDF, PNG, JPG, or DOCX</span>
        </div>
      </label>

      <button type="button" class="attachment-html-convert-box" id="open-html-attachment-btn" onclick="openHtmlAttachmentDrawer()" title="Paste HTML and convert to PDF, Image, or DOCX attachment">
        <div class="upload-box-icon html-convert-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </div>
        <div class="upload-box-text">
          <span class="upload-main-text">Paste HTML & Convert</span>
          <span class="upload-sub-text">Convert to PDF, Image, or DOCX</span>
        </div>
      </button>
    </div>
  `;
  const fileInput = document.querySelector("#attachment-file-input");
  if (fileInput) fileInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
}

function renderAttachmentCard(filename, formatOrIsImage = "pdf") {
  let format = typeof formatOrIsImage === "boolean" ? (formatOrIsImage ? "png" : "pdf") : formatOrIsImage;
  const isTemplate = Boolean(currentAttachment?.isHtmlTemplate);

  let iconMarkup = "";
  let badgeMarkup = "";

  if (isTemplate) {
    iconMarkup = `<div class="doc-icon-badge badge-pdf-icon" style="background: rgba(236, 72, 153, 0.15); color: #ec4899;" title="Dynamic HTML Template attachment">⚡</div>`;
    badgeMarkup = `<span class="attachment-format-badge" style="background: linear-gradient(135deg, #ec4899, #8b5cf6); color: white;" title="Converts per recipient during send">DYNAMIC ${format.toUpperCase()}</span>`;
  } else if (format === "png" || format === "image") {
    iconMarkup = `<div class="doc-icon-badge badge-image-icon" title="Image attachment">🖼️</div>`;
    badgeMarkup = `<span class="attachment-format-badge format-badge-image">PNG</span>`;
  } else if (format === "docx") {
    iconMarkup = `<div class="doc-icon-badge badge-docx-icon" title="DOCX Word attachment">📝</div>`;
    badgeMarkup = `<span class="attachment-format-badge format-badge-docx">DOCX</span>`;
  } else {
    iconMarkup = `<div class="doc-icon-badge badge-pdf-icon" title="PDF document attachment">📄</div>`;
    badgeMarkup = `<span class="attachment-format-badge format-badge-pdf">PDF</span>`;
  }

  attachmentsContainer.innerHTML = `
    <div class="attachment-card">
      ${iconMarkup}
      <span class="attachment-name" id="current-attachment-filename-span">${escapeHtml(filename)}</span>
      ${badgeMarkup}
      <button type="button" class="attachment-delete" id="remove-attachment-btn" title="Remove attachment">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  `;

  document.querySelector("#remove-attachment-btn").addEventListener("click", () => {
    currentAttachment = null;
    renderEmptyDropzone();
    log(`Attachment removed.`, "info");
  });
}

// 4. EDITOR MODES & RICH TEXT TOOLBAR
function setEditorMode(mode) {
  editorMode = mode;
  if (mode === "html") {
    // Transfer HTML from visual container to textarea
    messageInput.value = messageVisual.innerHTML;
    messageVisual.classList.add("hidden");
    messageInput.classList.remove("hidden");
    messageInput.classList.add("code-mode");
    if (richToolbar) richToolbar.classList.add("hidden");
    modeNormalBtn.classList.remove("active");
    modeHtmlBtn.classList.add("active");
    activeInput = messageInput;
    messageInput.focus();
    log("Switched to HTML Source mode.", "sys");
  } else {
    // Transfer HTML from textarea to visual container
    messageVisual.innerHTML = messageInput.value;
    messageInput.classList.add("hidden");
    messageInput.classList.remove("code-mode");
    messageVisual.classList.remove("hidden");
    if (richToolbar) richToolbar.classList.remove("hidden");
    modeHtmlBtn.classList.remove("active");
    modeNormalBtn.classList.add("active");
    activeInput = messageVisual;
    messageVisual.focus();
    log("Switched to Normal (Visual Editable & Live Preview) mode.", "sys");
  }
}

if (modeNormalBtn) modeNormalBtn.addEventListener("click", () => setEditorMode("normal"));
if (modeHtmlBtn) modeHtmlBtn.addEventListener("click", () => setEditorMode("html"));

// Live sync between visual div and textarea
if (messageVisual) {
  messageVisual.addEventListener("input", () => {
    messageInput.value = messageVisual.innerHTML;
  });
}

if (messageInput) {
  messageInput.addEventListener("input", () => {
    messageVisual.innerHTML = messageInput.value;
  });
}

// Rich Text formatting button actions
document.querySelectorAll(".format-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const cmd = btn.getAttribute("data-cmd");
    if (!cmd || editorMode === "html") return;

    if (cmd === "createLink") {
      const url = prompt("Enter website URL:", "https://");
      if (url) document.execCommand(cmd, false, url);
    } else {
      document.execCommand(cmd, false, null);
    }
    if (messageVisual) {
      messageVisual.focus();
      messageInput.value = messageVisual.innerHTML;
    }
  });
});

// Track focused active input for variable insertion
[subjectInput, messageVisual, messageInput].forEach((input) => {
  if (input) {
    input.addEventListener("focus", () => { activeInput = input; });
    if (input === messageVisual) {
      input.addEventListener("click", () => { activeInput = messageVisual; });
    }
  }
});

// 5. VARIABLE & HTML TEMPLATE DRAWERS
const htmlTemplates = {
  modern: `<div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
  <div style="background: linear-gradient(135deg, #2563eb, #3b82f6); padding: 32px 28px;">
    <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700;">Exclusive Invitation for {name}</h1>
  </div>
  <div style="padding: 32px 28px; line-height: 1.6;">
    <p style="font-size: 16px; margin-top: 0;">Hi <strong>{name}</strong>,</p>
    <p style="font-size: 15px; color: #334155;">We hope this email finds you well! We are reaching out to inform you about our latest updates for <code>{email}</code>.</p>
    <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 24px 0;">
      <p style="margin: 0; font-size: 14px; color: #475569;">💡 <strong>Highlight:</strong> Experience faster delivery and customized email templates with zero hassle.</p>
    </div>
    <div style="margin: 32px 0;">
      <a href="https://example.com" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">Get Started Today &rarr;</a>
    </div>
    <p style="font-size: 15px; color: #334155; margin-bottom: 0;">Best regards,<br><strong>Your Team</strong></p>
  </div>
</div>`,

  newsletter: `<div style="max-width: 580px; margin: 0 auto; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.7; padding: 20px;">
  <h2 style="font-size: 24px; font-weight: 800; color: #0f172a; margin-top: 0;">Hello {name},</h2>
  <p style="font-size: 16px; color: #334155;">Thank you for connecting with us! Here are 3 quick updates for this week:</p>
  <ul style="padding-left: 20px; color: #334155; font-size: 15px;">
    <li style="margin-bottom: 10px;"><strong>Feature Release:</strong> Rich text &amp; HTML template drawer directly in composer.</li>
    <li style="margin-bottom: 10px;"><strong>Deliverability Improvements:</strong> Direct sending via Gmail API.</li>
    <li style="margin-bottom: 10px;"><strong>Account Sync:</strong> Configured for <code>{email}</code>.</li>
  </ul>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0;" />
  <p style="font-size: 14px; color: #64748b;">If you have any questions, reply directly to this message!</p>
</div>`,

  followup: `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #222222; line-height: 1.6;">
  <p>Hi <strong>{name}</strong>,</p>
  <p>I wanted to follow up on our previous conversation regarding your account (<code>{email}</code>).</p>
  <p>Do you have 5 minutes this week for a quick call to go over the details?</p>
  <p>Thanks,<br><strong>Tuhin Thakur</strong></p>
</div>`,

  announcement: `<div style="max-width: 600px; margin: 0 auto; font-family: Inter, BlinkMacSystemFont, sans-serif; color: #0f172a; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 32px;">
  <div style="background: linear-gradient(135deg, #059669, #10b981); color: white; padding: 12px 18px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block; margin-bottom: 20px;">🚀 SPECIAL LAUNCH ANNOUNCEMENT</div>
  <h1 style="font-size: 24px; font-weight: 800; margin-top: 0; color: #0f172a;">Welcome to the future, {name}!</h1>
  <p style="font-size: 16px; color: #475569; line-height: 1.6;">We have upgraded your account registered at <code>{email}</code> with exclusive access to premium broadcasting features.</p>
  <div style="margin-top: 28px;">
    <a href="https://example.com" style="background: #059669; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; display: inline-block;">Claim Your Upgrade &rarr;</a>
  </div>
</div>`
};

function openTemplateDrawer() {
  const drawer = document.querySelector("#template-drawer");
  if (drawer) {
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
  }
}

function closeTemplateDrawer() {
  const drawer = document.querySelector("#template-drawer");
  if (drawer) {
    drawer.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
  }
}

function applyTemplate(key) {
  const html = htmlTemplates[key];
  if (!html) return;
  messageInput.value = html;
  if (messageVisual) messageVisual.innerHTML = html;
  closeTemplateDrawer();
  log(`Applied "${key}" HTML email template.`, "sys");
}

const variableDrawer = document.querySelector("#variable-drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const closeDrawerBtn = document.querySelector("#close-drawer-btn");

function openVariableDrawer() {
  if (variableDrawer) {
    variableDrawer.classList.remove("hidden");
    variableDrawer.setAttribute("aria-hidden", "false");
  }
}

function closeVariableDrawer() {
  if (variableDrawer) {
    variableDrawer.classList.add("hidden");
    variableDrawer.setAttribute("aria-hidden", "true");
  }
}

if (variableTriggerBtn) {
  variableTriggerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openVariableDrawer();
  });
}

if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeVariableDrawer);
if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeVariableDrawer);

document.querySelectorAll(".variable-chip-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const varName = btn.getAttribute("data-variable");
    if (!varName) return;
    const tag = `{${varName}}`;

    if (activeInput === messageVisual && editorMode === "normal") {
      messageVisual.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(tag);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        messageVisual.appendChild(document.createTextNode(tag));
      }
      messageInput.value = messageVisual.innerHTML;
    } else {
      const inputEl = activeInput || messageInput;
      const start = inputEl.selectionStart || inputEl.value.length;
      const end = inputEl.selectionEnd || inputEl.value.length;
      const text = inputEl.value;
      inputEl.value = text.substring(0, start) + tag + text.substring(end);
      inputEl.focus();
      inputEl.selectionStart = inputEl.selectionEnd = start + tag.length;
      if (inputEl === messageInput) messageVisual.innerHTML = messageInput.value;
    }

    closeVariableDrawer();
    log(`Inserted variable tag ${tag} into template.`, "info");
  });
});

// Broadcast / Dry Run toggle listener
broadcastCheckbox.addEventListener("change", (e) => {
  if (e.target.checked) {
    statMode.textContent = "Mode: Broadcast (Live)";
    log("Switched to Broadcast mode (Live email sending).", "sys");
  } else {
    statMode.textContent = "Mode: Dry Run (Test)";
    log("Switched to Dry Run mode (Validation only).", "sys");
  }
});

// Clear Terminal
clearTerminalBtn.addEventListener("click", () => {
  terminal.innerHTML = "";
  log("Terminal log cleared.", "sys");
});

// Discard Form
discardBtn.addEventListener("click", () => {
  subjectInput.value = "";
  messageInput.value = "";
  if (messageVisual) messageVisual.innerHTML = "";
  loadedRecipients = [];
  currentAttachment = null;
  renderRecipientsUI();
  renderEmptyDropzone();
  statRecipients.textContent = "Recipients: 0";
  log("Composer discarded.", "sys");
});

// 6. FORM SUBMISSION & SENDING
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (loadedRecipients.length === 0) {
    alert("Please select a CSV file with recipient emails before sending.");
    return;
  }

  const subject = subjectInput.value.trim();
  const message = (editorMode === "html" ? messageInput.value : (messageVisual.innerHTML || messageInput.value)).trim();
  if (!subject || !message) {
    alert("Subject and Message body are required.");
    return;
  }

  const isBroadcast = broadcastCheckbox.checked;
  const delayMs = Math.max(100, Math.min(Number(cfgDelayInput.value) || 750, 5000));
  const total = loadedRecipients.length;

  sendButton.disabled = true;
  progressContainer.classList.remove("hidden");
  progressBarFill.style.width = "0%";
  progressText.textContent = `0 / ${total} processed`;

  log(`Starting ${isBroadcast ? "BROADCAST" : "DRY RUN"} for ${total} recipient(s)...`, "sys");

  let sentCount = 0;
  let failCount = 0;

  for (let i = 0; i < total; i++) {
    const rec = loadedRecipients[i];
    const pct = Math.round(((i + 1) / total) * 100);
    progressBarFill.style.width = `${pct}%`;

    let singleAttachment = currentAttachment;

    if (currentAttachment && currentAttachment.isHtmlTemplate) {
      progressText.textContent = `Converting attachment for ${rec.email} (${i + 1}/${total})...`;
      try {
        const { base64, mimeType } = await renderAndConvertRecipientAttachment(
          currentAttachment.htmlSource,
          currentAttachment.format,
          rec,
          subject
        );
        const recipientFilename = personalize(currentAttachment.name, rec);
        singleAttachment = {
          name: recipientFilename,
          mimeType: mimeType,
          base64: base64
        };
        log(`Converted ${currentAttachment.format.toUpperCase()} "${recipientFilename}" for <${rec.email}>`, "info");
      } catch (convErr) {
        log(`Attachment Conversion Error for <${rec.email}>: ${convErr.message}`, "error");
        failCount++;
        continue;
      }
    }

    progressText.textContent = `Sending to ${rec.email} (${i + 1}/${total})...`;

    try {
      const requestPayload = {
        delay_ms: delayMs,
        recipients: [rec],
        subject,
        message,
        attachment: singleAttachment,
        dryRun: !isBroadcast
      };

      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sending failed.");

      if (data.dryRun) {
        const attInfo = singleAttachment ? ` [Attachment: ${singleAttachment.name}]` : "";
        log(`DRY-RUN (${i + 1}/${total}): Validated recipient <${rec.email}>${attInfo}`, "dry");
        sentCount++;
      } else {
        const resItem = data.results && data.results[0];
        if (resItem && resItem.status === "sent") {
          sentCount++;
          const attInfo = singleAttachment ? ` [Attachment: ${singleAttachment.name}]` : "";
          log(`SENT (${i + 1}/${total}) -> ${rec.email}${attInfo}`, "sent");
        } else {
          failCount++;
          log(`FAILED (${i + 1}/${total}) -> ${rec.email}: ${resItem?.error || "Send rejected"}`, "error");
        }
      }
    } catch (err) {
      failCount++;
      log(`FAILED (${i + 1}/${total}) -> ${rec.email}: ${err.message}`, "error");
    }

    if (i < total - 1 && isBroadcast && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  log(`Finished run: ${sentCount} ${isBroadcast ? "sent" : "validated"}, ${failCount} failed.`, "sys");
  sendButton.disabled = false;
});

// 7. HTML CODE SIDE DRAWER
function openHtmlCodeDrawer() {
  const drawer = document.querySelector("#html-code-drawer");
  const codeInput = document.querySelector("#drawer-html-input");
  if (drawer && codeInput) {
    codeInput.value = messageVisual ? messageVisual.innerHTML : messageInput.value;
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    codeInput.focus();
    log("Opened HTML Source Editor side drawer.", "sys");
  }
}

function closeHtmlCodeDrawer() {
  const drawer = document.querySelector("#html-code-drawer");
  if (drawer) {
    drawer.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
  }
}

function syncAndCloseHtmlCodeDrawer() {
  const codeInput = document.querySelector("#drawer-html-input");
  if (codeInput) {
    const val = codeInput.value;
    messageInput.value = val;
    if (messageVisual) messageVisual.innerHTML = val;
    log("Applied HTML source changes to composer.", "sys");
  }
  closeHtmlCodeDrawer();
}

function insertTagIntoCode(tag) {
  const codeInput = document.querySelector("#drawer-html-input");
  if (!codeInput) return;
  const start = codeInput.selectionStart || codeInput.value.length;
  const end = codeInput.selectionEnd || codeInput.value.length;
  const text = codeInput.value;
  codeInput.value = text.substring(0, start) + tag + text.substring(end);
  codeInput.focus();
  codeInput.selectionStart = codeInput.selectionEnd = start + tag.length;
  messageInput.value = codeInput.value;
  if (messageVisual) messageVisual.innerHTML = codeInput.value;
}

// 8. HTML TO ATTACHMENT CONVERTER ENGINE & DRAWER HANDLERS
function selectAttachmentFormat(format) {
  selectedAttachmentFormat = format;
  document.querySelectorAll(".format-segment-btn").forEach((btn) => {
    if (btn.getAttribute("data-format") === format) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  const pill = document.querySelector("#generate-btn-format-pill");
  if (pill) pill.textContent = format.toUpperCase();

  updateAttachmentFilenameFromSubject();
}

function updateAttachmentHtmlPreview() {
  const input = document.querySelector("#attachment-html-input");
  const preview = document.querySelector("#attachment-html-preview");
  if (!input || !preview) return;

  const html = input.value.trim();
  if (!html) {
    preview.innerHTML = `<div class="preview-placeholder">Paste HTML or choose a quick template above to render preview</div>`;
  } else {
    preview.innerHTML = html;
  }
}

function useComposerHtmlForAttachment() {
  const html = (editorMode === "html" ? messageInput.value : (messageVisual.innerHTML || messageInput.value)).trim();
  const input = document.querySelector("#attachment-html-input");
  if (input) {
    input.value = html || "<p>Hello <b>{name}</b></p>";
    updateAttachmentHtmlPreview();
    log("Copied composer email body HTML into attachment editor.", "info");
  }
}

function loadSampleInvoiceHtml() {
  const html = `<div style="padding: 24px; font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
  <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px;">
    <h2 style="margin: 0; color: #2563eb;">INVOICE #1094</h2>
    <div style="text-align: right; font-size: 13px; color: #64748b;">Date: 2026-08-01</div>
  </div>
  <p><strong>Billed To:</strong> {name} (<code>{email}</code>)</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
    <thead>
      <tr style="background: #f1f5f9; text-align: left;">
        <th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Service Description</th>
        <th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">Pro Subscription (Annual)</td>
        <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; text-align: right;">$299.00</td>
      </tr>
    </tbody>
  </table>
  <div style="text-align: right; font-size: 16px; font-weight: bold; color: #0f172a;">Total: $299.00</div>
</div>`;
  const input = document.querySelector("#attachment-html-input");
  if (input) {
    input.value = html;
    updateAttachmentHtmlPreview();
    log("Loaded Sample Invoice HTML.", "info");
  }
}

function loadSampleCertificateHtml() {
  const html = `<div style="padding: 32px; font-family: Georgia, serif; text-align: center; border: 8px double #2563eb; background: #fdfbf7; color: #1e293b;">
  <h1 style="font-size: 28px; color: #1e3a8a; letter-spacing: 1px; margin-bottom: 8px;">CERTIFICATE OF COMPLETION</h1>
  <p style="font-style: italic; color: #475569; margin-bottom: 24px;">This is proudly presented to</p>
  <h2 style="font-size: 26px; color: #2563eb; margin: 16px 0; text-decoration: underline;">{name}</h2>
  <p style="font-size: 15px; color: #334155; line-height: 1.6;">For successfully completing the Advanced Web Mailer & Automation Certification.</p>
  <div style="margin-top: 40px; font-size: 13px; color: #64748b;">Issued on August 2026 • Verified Code: #GMAIL-2026</div>
</div>`;
  const input = document.querySelector("#attachment-html-input");
  if (input) {
    input.value = html;
    updateAttachmentHtmlPreview();
    log("Loaded Sample Certificate HTML.", "info");
  }
}

function insertTagIntoAttachmentHtml(tag) {
  const input = document.querySelector("#attachment-html-input");
  if (!input) return;
  const start = input.selectionStart || input.value.length;
  const end = input.selectionEnd || input.value.length;
  const text = input.value;
  input.value = text.substring(0, start) + tag + text.substring(end);
  input.focus();
  input.selectionStart = input.selectionEnd = start + tag.length;
  updateAttachmentHtmlPreview();
}

function openHtmlAttachmentDrawer() {
  const drawer = document.querySelector("#html-attachment-drawer");
  const input = document.querySelector("#attachment-html-input");
  if (drawer) {
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    updateAttachmentFilenameFromSubject();
    if (input) {
      if (!input.value) useComposerHtmlForAttachment();
      else updateAttachmentHtmlPreview();
    }
    log("Opened HTML Attachment Converter side panel.", "sys");
  }
}

function closeHtmlAttachmentDrawer() {
  const drawer = document.querySelector("#html-attachment-drawer");
  if (drawer) {
    drawer.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
  }
}

async function generatePngFromElement(element) {
  if (window.html2canvas) {
    const canvas = await window.html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: -window.scrollY
    });
    return canvas.toDataURL("image/png").split(",")[1];
  } else {
    return new Promise((resolve, reject) => {
      const width = element.offsetWidth || 600;
      const height = element.offsetHeight || 400;
      const htmlContent = element.innerHTML;
      const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="background:#fff; width:100%; height:100%;">
            ${htmlContent}
          </div>
        </foreignObject>
      </svg>`;
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png").split(",")[1]);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to render HTML image."));
      };
      img.src = url;
    });
  }
}

async function generatePdfFromElement(element) {
  if (window.html2canvas) {
    const canvas = await window.html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: -window.scrollY
    });
    const imgData = canvas.toDataURL("image/png");
    if (window.jspdf && window.jspdf.jsPDF) {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? "landscape" : "portrait", unit: "pt", format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      const dataUri = pdf.output("datauristring");
      return dataUri.split(",")[1];
    }
  }
  return await generatePngFromElement(element);
}

function generateDocxBase64FromHtml(htmlContent, subject) {
  const docHeader = `<html xmlns:o='urn:schemas-microsoft-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${escapeHtml(subject)}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
body { font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111111; padding: 20pt; }
p { margin-bottom: 10pt; }
h1, h2, h3 { color: #1f2937; }
table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
td, th { border: 1px solid #cbd5e1; padding: 8pt; text-align: left; }
th { background-color: #f1f5f9; font-weight: bold; }
</style>
</head>
<body>
${htmlContent}
</body>
</html>`;
  return btoa(unescape(encodeURIComponent(docHeader)));
}

function personalize(template, recipient) {
  return (template || "").replace(/\{(\w+)\}/g, (match, key) => recipient[key] ?? match);
}

async function renderAndConvertRecipientAttachment(htmlSource, format, recipient, rawSubject) {
  const personalizedHtml = personalize(htmlSource, recipient);
  const previewFrame = document.querySelector("#attachment-html-preview");

  const tempDiv = document.createElement("div");
  tempDiv.className = "temp-attachment-render-container";
  tempDiv.style.position = "absolute";
  tempDiv.style.top = "0";
  tempDiv.style.left = "0";
  tempDiv.style.width = "750px";
  tempDiv.style.minHeight = "400px";
  tempDiv.style.background = "#ffffff";
  tempDiv.style.color = "#1e293b";
  tempDiv.style.padding = "24px";
  tempDiv.style.boxSizing = "border-box";
  tempDiv.style.zIndex = "-9999";
  tempDiv.style.opacity = "1";
  tempDiv.innerHTML = personalizedHtml;
  document.body.appendChild(tempDiv);

  const originalPreview = previewFrame ? previewFrame.innerHTML : null;
  if (previewFrame) {
    previewFrame.innerHTML = personalizedHtml;
  }

  try {
    const targetElement = (previewFrame && previewFrame.offsetWidth > 0) ? previewFrame : tempDiv;
    let base64 = "";
    let mimeType = "";

    if (format === "png" || format === "image") {
      base64 = await generatePngFromElement(targetElement);
      mimeType = "image/png";
    } else if (format === "pdf") {
      base64 = await generatePdfFromElement(targetElement);
      mimeType = "application/pdf";
    } else if (format === "docx") {
      base64 = generateDocxBase64FromHtml(personalizedHtml, personalize(rawSubject || "Attachment", recipient));
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    if (!base64 || base64.trim().length < 50) {
      throw new Error(`Generated ${format.toUpperCase()} attachment base64 is empty or invalid.`);
    }

    return { base64, mimeType };
  } finally {
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
    if (previewFrame && originalPreview !== null) {
      previewFrame.innerHTML = originalPreview;
    }
  }
}

async function convertAndAttachHtml() {
  const inputEl = document.querySelector("#attachment-html-input");
  if (!inputEl || !inputEl.value.trim()) {
    alert("Please enter or paste HTML content first.");
    return;
  }

  const format = selectedAttachmentFormat || "pdf";
  const filename = getSanitizedSubjectFilename(format);

  currentAttachment = {
    isHtmlTemplate: true,
    htmlSource: inputEl.value.trim(),
    format: format,
    name: filename,
    isSubjectSynced: true
  };

  renderAttachmentCard(filename, format);
  closeHtmlAttachmentDrawer();
  log(`Attached Dynamic HTML (${format.toUpperCase()}). Will convert live for each recipient during send.`, "info");
}

// Subject input listener for live attachment filename auto-update
if (subjectInput) {
  subjectInput.addEventListener("input", updateAttachmentFilenameFromSubject);
}

// Bind all global drawer handlers to window so inline onclick always works
window.openHtmlCodeDrawer = openHtmlCodeDrawer;
window.closeHtmlCodeDrawer = closeHtmlCodeDrawer;
window.syncAndCloseHtmlCodeDrawer = syncAndCloseHtmlCodeDrawer;
window.insertTagIntoCode = insertTagIntoCode;
window.openTemplateDrawer = openTemplateDrawer;
window.closeTemplateDrawer = closeTemplateDrawer;
window.applyTemplate = applyTemplate;
window.openVariableDrawer = openVariableDrawer;
window.closeVariableDrawer = closeVariableDrawer;

window.openHtmlAttachmentDrawer = openHtmlAttachmentDrawer;
window.closeHtmlAttachmentDrawer = closeHtmlAttachmentDrawer;
window.selectAttachmentFormat = selectAttachmentFormat;
window.useComposerHtmlForAttachment = useComposerHtmlForAttachment;
window.loadSampleInvoiceHtml = loadSampleInvoiceHtml;
window.loadSampleCertificateHtml = loadSampleCertificateHtml;
window.insertTagIntoAttachmentHtml = insertTagIntoAttachmentHtml;
window.convertAndAttachHtml = convertAndAttachHtml;

// Event listeners for side drawer buttons
const openHtmlDrawerBtn = document.querySelector("#open-html-drawer-btn");
if (openHtmlDrawerBtn) {
  openHtmlDrawerBtn.onclick = (e) => {
    e.preventDefault();
    openHtmlCodeDrawer();
  };
}

const drawerCodeInput = document.querySelector("#drawer-html-input");
if (drawerCodeInput) {
  drawerCodeInput.addEventListener("input", () => {
    messageInput.value = drawerCodeInput.value;
    if (messageVisual) messageVisual.innerHTML = drawerCodeInput.value;
  });
}

const attachmentHtmlInput = document.querySelector("#attachment-html-input");
if (attachmentHtmlInput) {
  attachmentHtmlInput.addEventListener("input", updateAttachmentHtmlPreview);
}

// INITIALIZE
loadConfig();
renderRecipientsUI();
renderEmptyDropzone();
