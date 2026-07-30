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
const cfgGmailInput = document.querySelector("#cfg-gmail");
const cfgAppPasswordInput = document.querySelector("#cfg-app-password");
const cfgDelayInput = document.querySelector("#cfg-delay");
const cfgDryRunCheckbox = document.querySelector("#cfg-dry-run");
const cfgSaveBtn = document.querySelector("#cfg-save-btn");
const cfgCancelBtn = document.querySelector("#cfg-cancel-btn");

// Form Inputs & Recipients
const csvInput = document.querySelector("#csv-input");
const recipientsList = document.querySelector("#recipients-list");
const subjectInput = document.querySelector("#subject-input");
const messageInput = document.querySelector("#message-input");
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
let activeConfig = { gmail: "", app_password: "", dry_run: false, delay_ms: 750 };
let activeInput = messageInput;

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

// 1. CONFIGURATION MANAGEMENT
async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const data = await res.json();
    activeConfig = data;

    if (data.gmail) {
      const parts = data.gmail.split("@")[0];
      const displayName = parts.charAt(0).toUpperCase() + parts.slice(1);
      profileDisplayName.textContent = `${displayName} (me)`;
      avatarInitials.textContent = parts.slice(0, 2).toUpperCase();
      cfgGmailInput.value = data.gmail;
    }
    cfgAppPasswordInput.value = data.app_password || "";
    cfgDelayInput.value = data.delay_ms || 750;
    cfgDryRunCheckbox.checked = Boolean(data.dry_run);

    if (data.dry_run) {
      broadcastCheckbox.checked = false;
      statMode.textContent = "Mode: Dry Run (Test)";
    } else {
      broadcastCheckbox.checked = true;
      statMode.textContent = "Mode: Broadcast (Live)";
    }

    log(`Loaded sender profile (${data.gmail || "No Gmail configured"}).`, "sys");
  } catch (err) {
    log(`Could not load config: ${err.message}`, "error");
  }
}

profileBadgeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  configModal.classList.toggle("hidden");
});

cfgCancelBtn.addEventListener("click", () => {
  configModal.classList.add("hidden");
});

cfgSaveBtn.addEventListener("click", async () => {
  const gmail = cfgGmailInput.value.trim();
  const app_password = cfgAppPasswordInput.value.trim();
  const delay_ms = Number(cfgDelayInput.value) || 750;
  const dry_run = cfgDryRunCheckbox.checked;

  if (!gmail) return alert("Please enter a Gmail address.");

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmail, app_password, delay_ms, dry_run }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save configuration.");

    activeConfig.gmail = gmail;
    activeConfig.delay_ms = delay_ms;
    activeConfig.dry_run = dry_run;

    const parts = gmail.split("@")[0];
    profileDisplayName.textContent = `${parts.charAt(0).toUpperCase() + parts.slice(1)} (me)`;
    avatarInitials.textContent = parts.slice(0, 2).toUpperCase();
    configModal.classList.add("hidden");

    log(`Config updated: Sender set to ${gmail}.`, "sys");
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
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

// 3. ATTACHMENT HANDLING (PDF & Images with Dashed Dropzone)
function handleFileSelect(file) {
  if (!file) return;

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");

  const reader = new FileReader();
  reader.onload = () => {
    currentAttachment = {
      name: file.name,
      mimeType: file.type || (isPdf ? "application/pdf" : "image/png"),
      base64: reader.result.split(",")[1],
      isImage
    };
    renderAttachmentCard(file.name, isImage);
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
    <label class="attachment-upload-box" id="attachment-dropzone" title="Click or drag & drop a PDF or image file">
      <input id="attachment-file-input" type="file" accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.gif,.webp" hidden />
      <div class="upload-box-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </div>
      <div class="upload-box-text">
        <span class="upload-main-text">Click or drop PDF / image to attach</span>
        <span class="upload-sub-text">Supports PDF, PNG, JPG, GIF, WEBP</span>
      </div>
    </label>
  `;
  document.querySelector("#attachment-file-input").addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
}

function renderAttachmentCard(filename, isImage = false) {
  const iconMarkup = isImage
    ? `<div class="pdf-icon-badge" style="background: #2563eb;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
       </div>`
    : `<div class="pdf-icon-badge">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM9.5 11.5C9.5 12.33 8.83 13 8 13H7V15H5.5V9H8C8.83 9 9.5 9.67 9.5 10.5V11.5ZM14.5 13.5C14.5 14.33 13.83 15 13 15H10.5V9H13C13.83 9 14.5 9.67 14.5 10.5V13.5ZM19.5 10.5H17V11.5H19.5V13H17V15H15.5V9H19.5V10.5Z"/>
        </svg>
       </div>`;

  attachmentsContainer.innerHTML = `
    <div class="attachment-card">
      ${iconMarkup}
      <span class="attachment-name">${escapeHtml(filename)}</span>
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

// 4. VARIABLE FEATURE (Slide-Up Drawer Overlay matching 2nd screenshot)
const variableDrawer = document.querySelector("#variable-drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const closeDrawerBtn = document.querySelector("#close-drawer-btn");

[subjectInput, messageInput].forEach((input) => {
  if (input) {
    input.addEventListener("focus", () => { activeInput = input; });
  }
});

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

    // Insert into active textarea / input at cursor position
    const start = activeInput.selectionStart || activeInput.value.length;
    const end = activeInput.selectionEnd || activeInput.value.length;
    const text = activeInput.value;
    activeInput.value = text.substring(0, start) + tag + text.substring(end);
    activeInput.focus();
    activeInput.selectionStart = activeInput.selectionEnd = start + tag.length;

    closeVariableDrawer();
    if (variableMenu) variableMenu.classList.add("hidden");
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
  loadedRecipients = [];
  currentAttachment = null;
  renderRecipientsUI();
  renderEmptyDropzone();
  statRecipients.textContent = "Recipients: 0";
  log("Composer discarded.", "sys");
});

// 5. FORM SUBMISSION & SENDING
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (loadedRecipients.length === 0) {
    alert("Please select a CSV file with recipient emails before sending.");
    return;
  }

  const subject = subjectInput.value.trim();
  const message = messageInput.value.trim();
  if (!subject || !message) {
    alert("Subject and Message body are required.");
    return;
  }

  const isBroadcast = broadcastCheckbox.checked;

  sendButton.disabled = true;
  progressContainer.classList.remove("hidden");
  progressBarFill.style.width = "0%";
  progressText.textContent = `0 / ${loadedRecipients.length} processed`;

  log(`Starting ${isBroadcast ? "BROADCAST" : "DRY RUN"} for ${loadedRecipients.length} recipient(s)...`, "sys");

  try {
    const requestPayload = {
      recipients: loadedRecipients,
      subject,
      message,
      attachment: currentAttachment,
      override_dry_run: !isBroadcast
    };

    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...activeConfig, dry_run: !isBroadcast }),
    });

    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sending failed.");

    if (data.dryRun) {
      log(`[DRY-RUN RESULT] ${data.message}`, "dry");
      loadedRecipients.forEach((rec, idx) => {
        log(`DRY-RUN (${idx + 1}/${loadedRecipients.length}): Validated recipient <${rec.email}>`, "dry");
        const pct = Math.round(((idx + 1) / loadedRecipients.length) * 100);
        progressBarFill.style.width = `${pct}%`;
        progressText.textContent = `${idx + 1} / ${loadedRecipients.length} validated`;
      });
      log(`Dry run complete. All ${loadedRecipients.length} email(s) validated successfully!`, "sys");
    } else {
      let sentCount = 0;
      let failCount = 0;
      data.results.forEach((resItem, idx) => {
        if (resItem.status === "sent") {
          sentCount++;
          log(`SENT (${idx + 1}/${loadedRecipients.length}) -> ${resItem.email}`, "sent");
        } else {
          failCount++;
          log(`FAILED (${idx + 1}/${loadedRecipients.length}) -> ${resItem.email}: ${resItem.error}`, "error");
        }
        const pct = Math.round(((idx + 1) / loadedRecipients.length) * 100);
        progressBarFill.style.width = `${pct}%`;
        progressText.textContent = `${idx + 1} / ${loadedRecipients.length} sent`;
      });
      log(`Finished batch run: ${sentCount} sent, ${failCount} failed.`, "sys");
    }
  } catch (err) {
    log(`Sending Error: ${err.message}`, "error");
  } finally {
    sendButton.disabled = false;
  }
});

// INITIALIZE
loadConfig();
renderRecipientsUI();
renderEmptyDropzone();
