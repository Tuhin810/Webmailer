# Web Gmail CSV mailer

A local HTML/JavaScript interface for the Gmail CSV mailer. The browser selects the CSV and PDF; the local Node.js server sends email through Gmail. Do not expose this server to the internet.

## Setup

1. From this folder, install the one dependency:

   ```bash
   npm install
   ```

2. Copy `config.example.json` to `config.json`.
3. In `config.json`, add your Gmail address and Google App Password. Keep `"dry_run": true` for the first check.
4. Start it:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000), choose your CSV and optional PDF, write the subject/message, and select **Validate and send**.

The terminal panel at the bottom of the page shows recipient validation and the sent/failed result for every email.

When the dry run looks correct, set `"dry_run": false` in `config.json` and restart the server to send. Use this only for recipients who have agreed to receive the message.
