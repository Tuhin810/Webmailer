const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MAX_BODY_SIZE = 25 * 1024 * 1024;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readConfig() {
  const configPath = path.join(ROOT, "config.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error("Create web-mailer/config.json by copying config.example.json.");
  }
  if (!config.gmail || !config.app_password) {
    throw new Error("Add gmail and app_password to web-mailer/config.json.");
  }
  return config;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_SIZE) {
        request.destroy();
        reject(new Error("Request is too large. Use a smaller attachment (max about 18 MB)."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid request data."));
      }
    });
    request.on("error", reject);
  });
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function validateRecipients(recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("Add at least one valid recipient.");
  }
  if (recipients.length > 500) throw new Error("Maximum 500 recipients per run.");
  return recipients.map((person, index) => {
    const email = typeof person?.email === "string" ? person.email.trim() : "";
    const name = typeof person?.name === "string" ? person.name.trim() : "";
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error(`Recipient ${index + 1} has an invalid email.`);
    return { email, name };
  });
}

function personalize(value, recipient) {
  return value.replaceAll("{name}", recipient.name).replaceAll("{email}", recipient.email);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function handleSend(request, response) {
  const data = await readBody(request);
  const recipients = validateRecipients(data.recipients);
  const subject = text(data.subject, "Subject");
  const message = text(data.message, "Message");
  const config = await readConfig();
  const attachment = data.attachment;
  if (attachment && (!attachment.name || !attachment.base64 || !attachment.mimeType)) {
    throw new Error("Attachment could not be read.");
  }

  if (config.dry_run !== false) {
    return sendJson(response, 200, {
      dryRun: true,
      message: `Dry run: ${recipients.length} email(s) validated. No email was sent.`,
    });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.gmail, pass: config.app_password },
  });
  const results = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: config.gmail,
        to: recipient.email,
        subject: personalize(subject, recipient),
        text: personalize(message, recipient),
        attachments: attachment
          ? [{ filename: attachment.name, content: Buffer.from(attachment.base64, "base64"), contentType: attachment.mimeType }]
          : [],
      });
      results.push({ email: recipient.email, status: "sent" });
    } catch (error) {
      results.push({ email: recipient.email, status: "failed", error: error.message });
    }
    if (recipients.indexOf(recipient) < recipients.length - 1) await wait(Number(config.delay_ms) || 750);
  }
  sendJson(response, 200, { dryRun: false, results });
}

async function serveFile(response, url) {
  const fileName = url === "/" ? "index.html" : url.slice(1);
  const safeFile = path.normalize(fileName).replace(/^(\.\.([/\\]|$))+/, "");
  const filePath = path.join(ROOT, "public", safeFile);
  if (!filePath.startsWith(path.join(ROOT, "public"))) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

async function handleGetConfig(request, response) {
  try {
    const config = await readConfig();
    sendJson(response, 200, {
      gmail: config.gmail || "",
      app_password: config.app_password || "",
      dry_run: config.dry_run !== false,
      delay_ms: config.delay_ms || 750,
      has_password: Boolean(config.app_password)
    });
  } catch (error) {
    sendJson(response, 200, { gmail: "", app_password: "", dry_run: true, delay_ms: 750, has_password: false, error: error.message });
  }
}

async function handleSaveConfig(request, response) {
  const data = await readBody(request);
  const configPath = path.join(ROOT, "config.json");
  let currentConfig = {};
  try {
    currentConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch {}

  const gmail = typeof data.gmail === "string" ? data.gmail.trim() : currentConfig.gmail || "";
  let app_password = currentConfig.app_password || "";
  if (typeof data.app_password === "string" && data.app_password.trim() && !data.app_password.includes("•")) {
    app_password = data.app_password.trim();
  }
  const dry_run = Boolean(data.dry_run);
  const delay_ms = Number(data.delay_ms) || 750;

  if (!gmail) throw new Error("Gmail address is required.");
  if (!app_password) throw new Error("App Password is required.");

  const updated = { gmail, app_password, dry_run, delay_ms };
  await fs.writeFile(configPath, JSON.stringify(updated, null, 2), "utf8");
  sendJson(response, 200, { success: true, message: "Configuration saved successfully.", gmail, dry_run, delay_ms });
}

http.createServer(async (request, response) => {
  try {
    const parsedUrl = request.url.split("?")[0];
    if (request.method === "GET" && parsedUrl === "/api/config") return await handleGetConfig(request, response);
    if (request.method === "POST" && parsedUrl === "/api/config") return await handleSaveConfig(request, response);
    if (request.method === "POST" && parsedUrl === "/api/send") return await handleSend(request, response);
    if (request.method === "GET") return await serveFile(response, parsedUrl);
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Something went wrong." });
  }
}).listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
