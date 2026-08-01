const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Automatically load .env file if present
try {
  const envPath = path.join(__dirname, ".env");
  if (fsSync.existsSync(envPath)) {
    const envContent = fsSync.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {
  // Ignore error if .env cannot be loaded
}

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MAX_BODY_SIZE = 25 * 1024 * 1024;
const SESSION_COOKIE = "mailer_oauth";
const STATE_COOKIE = "mailer_oauth_state";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const contentTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function redirect(response, location, cookies = []) {
  response.writeHead(302, { Location: location, ...(cookies.length ? { "Set-Cookie": cookies } : {}) });
  response.end();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_SIZE) return reject(new Error("Request is too large. Use a smaller attachment (max about 18 MB)."));
      chunks.push(chunk);
    });
    request.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("Invalid request data.")); } });
    request.on("error", reject);
  });
}

function text(value, field) { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`); return value.trim(); }
function personalize(template, recipient) { return template.replace(/\{(\w+)\}/g, (match, key) => recipient[key] ?? match); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function base64url(value) { return Buffer.from(value).toString("base64url"); }
function parseCookies(request) { return Object.fromEntries((request.headers.cookie || "").split(/;\s*/).filter(Boolean).map((item) => { const index = item.indexOf("="); return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))]; })); }
function cookie(name, value, maxAge) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}${maxAge === undefined ? "" : `Max-Age=${maxAge}; `}`; }
function clearCookie(name) { return cookie(name, "", 0); }

function oauthConfig(request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const encryptionSecret = process.env.SESSION_ENCRYPTION_KEY;
  const inferredRedirect = `${request.headers["x-forwarded-proto"] || "http"}://${request.headers.host}/api/auth/google/callback`;
  if (!clientId || !clientSecret || !encryptionSecret) throw new Error("Google OAuth is not configured on this server.");
  return { clientId, clientSecret, encryptionSecret, redirectUri: process.env.GOOGLE_REDIRECT_URI || inferredRedirect };
}

function encryptionKey(secret) { return crypto.createHash("sha256").update(secret).digest(); }
function encryptSession(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
function decryptSession(value, secret) {
  const raw = Buffer.from(value, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
}

async function tokenRequest(params, config) {
  const result = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri }) });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error_description || "Google authorization failed.");
  return data;
}

async function getSession(request) {
  const value = parseCookies(request)[SESSION_COOKIE];
  if (!value) return null;
  try { return decryptSession(value, oauthConfig(request).encryptionSecret); } catch { return null; }
}

async function accessToken(request) {
  const session = await getSession(request);
  if (!session?.refresh_token) throw new Error("Please sign in with Google before sending email.");
  const config = oauthConfig(request);
  const token = await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refresh_token }, config);
  return { token: token.access_token, session, config };
}

function safeHeader(value) { return String(value).replace(/[\r\n]+/g, " "); }
function isHtmlBody(str) { return /<[a-z][\s\S]*>/i.test(str); }
function makeRawEmail({ from, to, subject, message, attachment }) {
  const headers = [`From: ${safeHeader(from)}`, `To: ${safeHeader(to)}`, `Subject: ${safeHeader(subject)}`, "MIME-Version: 1.0"];
  const formattedMessage = isHtmlBody(message) ? message : message.replace(/\r?\n/g, "<br>");
  const contentType = "text/html; charset=UTF-8";
  if (!attachment || !attachment.base64) {
    return Buffer.from(`${headers.join("\r\n")}\r\nContent-Type: ${contentType}\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${formattedMessage}`, "utf8").toString("base64url");
  }
  const cleanBase64 = String(attachment.base64).replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!cleanBase64) {
    return Buffer.from(`${headers.join("\r\n")}\r\nContent-Type: ${contentType}\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${formattedMessage}`, "utf8").toString("base64url");
  }
  const boundary = `mailer-${crypto.randomBytes(12).toString("hex")}`;
  const attachmentData = cleanBase64.replace(/.{1,76}/g, "$&\r\n");
  const safeFilename = safeHeader(attachment.name || "attachment").replace(/"/g, "'");
  const body = [
    headers.join("\r\n"),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    "Content-Transfer-Encoding: 8bit",
    "",
    formattedMessage,
    `--${boundary}`,
    `Content-Type: ${safeHeader(attachment.mimeType || "application/octet-stream")}; name="${safeFilename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    "",
    attachmentData,
    `--${boundary}--`,
    ""
  ].join("\r\n");
  return Buffer.from(body, "utf8").toString("base64url");
}

async function handleSend(request, response) {
  const data = await readBody(request);
  const subject = text(data.subject, "Subject");
  const message = text(data.message, "Message");
  const rawFromName = typeof data.fromName === "string" ? data.fromName.trim() : "";
  const recipients = data.recipients;
  const delayMs = Math.max(100, Math.min(Number(data.delay_ms) || 750, 5000));
  if (!Array.isArray(recipients) || !recipients.length) throw new Error("Add at least one recipient email address.");
  if (data.dryRun) return sendJson(response, 200, { dryRun: true, results: recipients.map((r) => ({ email: r.email, status: "dry-run-success" })) });
  const { token, session } = await accessToken(request);
  const fromHeader = rawFromName ? `"${safeHeader(rawFromName).replace(/"/g, "'")}" <${safeHeader(session.email)}>` : safeHeader(session.email);
  const results = [];
  for (const recipient of recipients) {
    try {
      if (!recipient?.email || !String(recipient.email).includes("@")) throw new Error("Invalid recipient email.");
      let recipientAttachment = recipient.attachment || data.attachment;
      if (recipientAttachment) {
        recipientAttachment = {
          ...recipientAttachment,
          name: personalize(recipientAttachment.name || "Attachment", recipient)
        };
      }
      const recipientName = recipient.name ? personalize(recipient.name, recipient).trim() : "";
      const toHeader = recipientName ? `"${safeHeader(recipientName).replace(/"/g, "'")}" <${safeHeader(recipient.email)}>` : safeHeader(recipient.email);
      const raw = makeRawEmail({ from: fromHeader, to: toHeader, subject: personalize(subject, recipient), message: personalize(message, recipient), attachment: recipientAttachment });
      const sent = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
      if (!sent.ok) { const error = await sent.json(); throw new Error(error.error?.message || "Gmail rejected this message."); }
      results.push({ email: recipient.email, status: "sent" });
    } catch (error) { results.push({ email: recipient?.email || "unknown", status: "failed", error: error.message }); }
    if (recipients.indexOf(recipient) < recipients.length - 1) await wait(delayMs);
  }
  sendJson(response, 200, { dryRun: false, results });
}

async function handleGoogleLogin(request, response) {
  const config = oauthConfig(request);
  const state = crypto.randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: `openid email ${GMAIL_SEND_SCOPE}`, access_type: "offline", prompt: "consent", state }).toString();
  redirect(response, url.toString(), [cookie(STATE_COOKIE, state, 600)]);
}

async function handleGoogleCallback(request, response, url) {
  const cookies = parseCookies(request);
  const returnedState = url.searchParams.get("state") || "";
  if (!url.searchParams.get("code") || !cookies[STATE_COOKIE] || cookies[STATE_COOKIE].length !== returnedState.length || !crypto.timingSafeEqual(Buffer.from(cookies[STATE_COOKIE]), Buffer.from(returnedState))) return redirect(response, "/?oauth=error", [clearCookie(STATE_COOKIE)]);
  const config = oauthConfig(request);
  try {
    const tokens = await tokenRequest({ code: url.searchParams.get("code"), grant_type: "authorization_code" }, config);
    if (!tokens.refresh_token) throw new Error("Google did not issue a refresh token. Please approve access again.");
    const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then((res) => res.json());
    if (!profile.email) throw new Error("Could not determine the signed-in Gmail address.");
    redirect(response, "/?oauth=connected", [cookie(SESSION_COOKIE, encryptSession({ email: profile.email, refresh_token: tokens.refresh_token }, config.encryptionSecret), 60 * 60 * 24 * 30), clearCookie(STATE_COOKIE)]);
  } catch { redirect(response, "/?oauth=error", [clearCookie(STATE_COOKIE)]); }
}

async function serveFile(response, url) {
  const fileName = url === "/" ? "index.html" : url.slice(1);
  const safeFile = path.normalize(fileName).replace(/^(\.\.([/\\]|$))+/, "");
  const filePath = path.join(ROOT, "public", safeFile);
  if (!filePath.startsWith(path.join(ROOT, "public"))) return sendJson(response, 403, { error: "Forbidden" });
  try { const content = await fs.readFile(filePath); response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" }); response.end(content); } catch { sendJson(response, 404, { error: "Not found" }); }
}

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    if (pathname === "/api/auth/google/login" && request.method === "GET") return await handleGoogleLogin(request, response);
    if (pathname === "/api/auth/google/callback" && request.method === "GET") return await handleGoogleCallback(request, response, url);
    if (pathname === "/api/auth/status" && request.method === "GET") { const session = await getSession(request); return sendJson(response, 200, { connected: Boolean(session), email: session?.email || null }); }
    if (pathname === "/api/auth/logout" && request.method === "POST") {
      response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
      return sendJson(response, 200, { ok: true });
    }
    if (pathname === "/api/send") return request.method === "POST" ? await handleSend(request, response) : sendJson(response, 405, { error: "Method not allowed" });
    if (request.method === "GET") return await serveFile(response, pathname);
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) { sendJson(response, 400, { error: error.message || "Something went wrong." }); }
}).listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
