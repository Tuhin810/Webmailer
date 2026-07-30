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

function personalize(template, recipient) {
  return template.replace(/\{(\w+)\}/g, (match, key) => recipient[key] ?? match);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleSend(request, response) {
  const data = await readBody(request);
  const subject = text(data.subject, "Subject");
  const message = text(data.message, "Message");
  const recipients = data.recipients;
  const attachment = data.attachment;

  const gmail = typeof data.gmail === "string" ? data.gmail.trim() : "";
  const rawPass = typeof data.app_password === "string" ? data.app_password : "";
  const app_password = rawPass.replace(/\s+/g, "").trim();
  const delay_ms = Number(data.delay_ms) || 750;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("Add at least one recipient email address.");
  }

  if (!gmail) {
    throw new Error("Gmail Address is required. Click your profile badge in the top-left to enter your Gmail.");
  }
  if (!app_password) {
    throw new Error("16-character App Password is required. Click your profile badge in the top-left to enter your App Password.");
  }

  if (data.dryRun) {
    await wait(400);
    const results = recipients.map((r) => ({ email: r.email, status: "dry-run-success" }));
    return sendJson(response, 200, { dryRun: true, results });
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: { user: gmail, pass: app_password },
  });

  try {
    await transporter.verify();
  } catch (verifyError) {
    throw new Error(`Gmail SMTP Login Failed: ${verifyError.message || "Invalid credentials"}. Verify your Gmail and 16-character App Password.`);
  }

  const results = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: gmail,
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
    if (recipients.indexOf(recipient) < recipients.length - 1) await wait(delay_ms);
  }
  transporter.close();
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

http.createServer(async (request, response) => {
  try {
    const rawUrl = request.url.split("?")[0];
    const parsedUrl = rawUrl.length > 1 && rawUrl.endsWith("/") ? rawUrl.slice(0, -1) : rawUrl;

    if (parsedUrl === "/api/send") {
      if (request.method === "POST") return await handleSend(request, response);
      return sendJson(response, 405, { error: "Method not allowed" });
    }

    if (request.method === "GET") return await serveFile(response, parsedUrl);
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Something went wrong." });
  }
}).listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
