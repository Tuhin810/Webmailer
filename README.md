# Web Gmail CSV mailer

A web interface for sending personalized Gmail messages to an opted-in CSV list. Users sign in with Google; the app sends through the Gmail API and never asks for Gmail app passwords.

## Setup

1. From this folder, install the one dependency:

   ```bash
   npm install
   ```

2. Configure the following environment variables locally or in Vercel (do not commit them):

   ```bash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   SESSION_ENCRYPTION_KEY=a-long-random-secret
   ```

   In Google Cloud, enable the Gmail API, add `https://www.googleapis.com/auth/gmail.send` to the OAuth consent-screen scopes, and register the redirect URI exactly. For production this app uses:

   ```text
   https://webmailer-five.vercel.app/api/auth/google/callback
   ```

3. For local development, set the environment variables in your shell before starting the app. For Vercel, add all four under **Project Settings → Environment Variables**, then redeploy.
4. Start it:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000), click the **From** badge, choose **Sign in with Google**, then choose your CSV and optional PDF.

The terminal panel at the bottom of the page shows recipient validation and the sent/failed result for every email.

When the dry run looks correct, enable Broadcast to send. Use this only for recipients who have agreed to receive the message.
