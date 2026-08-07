# Deployment

Production runs on an Ubuntu VPS behind nginx, with the Node process
supervised by pm2.

```
browser ──HTTPS──> nginx (:443) ──HTTP──> node server.js (:3000)
```

## nginx

Copy the site config and enable it:

```bash
sudo cp deploy/nginx/mailer.priwon.com.conf /etc/nginx/sites-available/mailer.priwon.com
sudo ln -s /etc/nginx/sites-available/mailer.priwon.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Then issue the certificate. Certbot rewrites the file in place to add the TLS
block and an HTTP -> HTTPS redirect:

```bash
sudo certbot --nginx -d mailer.priwon.com
```

Note: after certbot edits it, the file on disk no longer matches the copy in
this repo. Re-applying this config will drop the TLS block, so re-run certbot
(or `certbot install`) if you ever overwrite it.

### Why the non-default settings

- `client_max_body_size 25m` — attachments are sent as base64 in the request
  body. nginx defaults to 1m and would reject them with a 413 before the
  request reaches Node.
- `X-Forwarded-Proto` / `X-Forwarded-Host` — nginx terminates TLS and proxies
  plain HTTP, so without these the app builds an `http://` OAuth redirect URI
  and Google rejects it with `redirect_uri_mismatch`. See `redirectUriFor()`
  in server.js.
- `proxy_read_timeout 300s` — sending runs hold connections open longer than
  the 60s default.

## Node process (pm2)

```bash
cd /home/ubuntu/Webmailer
npm ci --omit=dev
pm2 start server.js --name webmailer
pm2 save
pm2 startup systemd   # then run the command it prints
```

`NODE_ENV=production` matters: it gates the `Secure` flag on the session
cookie (see `cookie()` in server.js). Set it in `.env`.

Log rotation is not on by default:

```bash
pm2 install pm2-logrotate
```

A systemd unit is included at `deploy/webmailer.service` as an alternative to
pm2. Use one or the other, not both.

## Firewall

Both layers must allow traffic — ufw on the host, and the OVH network
firewall in the OVH manager.

```bash
sudo ufw allow 'Nginx Full'
sudo ufw deny 3000        # reachable only via nginx
```

## Google OAuth

Register in the Google Cloud console:

- Authorized origin: `https://mailer.priwon.com`
- Authorized redirect URI: `https://mailer.priwon.com/api/auth/google/callback`

Sign-in fails until both are present.
