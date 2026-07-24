# Cloudflare Worker: Groq Proxy

Keeps your Groq API key server-side. Deploy separately from the frontend.

## Setup

1. Install Wrangler:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. Edit `worker.js` — change `ALLOWED_ORIGINS` to your GitHub Pages URL.

3. Set the Groq API key as a secret (never commit it):
   ```bash
   wrangler secret put GROQ_API_KEY
   ```

4. (Optional) Create the rate-limit KV namespace:
   ```bash
   wrangler kv:namespace create RATE_LIMIT
   ```
   Paste the returned ID into `wrangler.toml`. If you skip this, delete the `[[kv_namespaces]]` block.

5. Deploy:
   ```bash
   wrangler deploy
   ```

Wrangler prints your Worker URL — paste it into the app's Setup tab.

## Local testing

```bash
wrangler dev
```

For local dev, put your key in `.dev.vars` (gitignored):
```
GROQ_API_KEY=gsk_your_key_here
```