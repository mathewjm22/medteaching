# LIC Teaching Document Generator

A web app for internal medicine teaching attendings to generate phase-aware, case-specific teaching documents for medical students in longitudinal integrated clerkships (LICs). Built on the CU School of Medicine MEPO framework.

## Features

- Paste a de-identified clinical note and get a structured, printable teaching document
- Auto-analyzes the note to extract active problems, patient quotes, and lab trends
- Generates one full teaching case per selected problem (differential, learning points, shelf questions, treatment approach, citations)
- Phase-aware content that calibrates to where the student is in their LIC year
- Four teaching lenses: General IM, Geriatrics, Primary Care, Complex Multimorbidity
- Optional external evidence integration (OpenEvidence, UpToDate, DynaMed, DoxGPT, PubMed) via copyable prompts
- Persistent long-term learning goals across sessions

## Quick start (local dev)

```bash
npm install
npm run dev
```

Open the printed URL. On the Setup tab, enable AI and either:
- Paste a Groq API key directly (for local testing), OR
- Enter your Cloudflare Worker proxy URL (recommended for deployment)

## Deployment

### Frontend (GitHub Pages)

1. Push this repo to GitHub
2. In repo Settings → Pages, set Source to "GitHub Actions"
3. In `vite.config.js`, set `base` to `"/your-repo-name/"`
4. Push to `main` — the workflow deploys automatically

### Backend proxy (Cloudflare Worker)

The `worker/` folder contains the Groq proxy. See `worker/README.md` for setup, or:

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler secret put GROQ_API_KEY   # paste your Groq key
wrangler deploy
```

Then edit `worker.js` to set `ALLOWED_ORIGINS` to your GitHub Pages URL.

## Privacy

De-identify clinical notes before pasting. When AI is enabled, note text is sent to Groq's servers. This app is not HIPAA-covered — verify your local compliance requirements.

## License

For educational use only.