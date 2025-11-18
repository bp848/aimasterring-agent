<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AI Mastering Pipeline

Full-stack reference for the AI mastering mock-up: Vite + React on the front-end, Express + Python + ffmpeg on the back-end, and Gemini for parameter generation.

## Requirements

- Node.js 18+ (20.x recommended for production)
- Python 3.10+ with access to `python/mastering_cli.py`
- `ffmpeg`/`ffprobe` available on `PATH`
- Google Gemini API key with access to the requested model

## Local Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   - Copy `.env.example` to `.env.local` and update:
     - `GEMINI_API_KEY` – required for `/api/mastering-params`
     - `MASTERING_SERVER_PORT` – defaults to `3001`
     - `PYTHON_BIN`, `FFMPEG_BIN`, `FFPROBE_BIN` – override paths if needed
     - Optional tuning knobs: `GEMINI_MODEL`, `GEMINI_RATE_LIMIT`, `GEMINI_MAX_RETRIES`

3. **Run the stack**
   ```bash
   # Terminal 1 – Python/Express API (ts-node)
   npm run server:dev

   # Terminal 2 – Vite front-end with proxy -> http://localhost:3000
   npm run dev
   ```
   Vite proxies `/api` and `/static` to the Express server on port 3001, so no manual CORS setup is required.

## Back-end APIs

| Method | Path                     | Description |
| ------ | ------------------------ | ----------- |
| `POST` | `/api/analyze`           | Uploads audio, runs `mastering_cli.py analyze`, and returns measured loudness/peak/crest metrics. |
| `POST` | `/api/master`            | Starts an async mastering job. Response contains `jobId`. Job status tracked via `/api/master/:jobId`. |
| `GET`  | `/api/master/:jobId`     | Poll job progress (`queued`→`processing`→`completed`) plus `finalMetrics`, download URL, and error if any. |
| `POST` | `/api/mastering-params`  | Proxy to Gemini with schema validation, retries, and in-memory rate limiting. |
| `GET`  | `/api/health`            | Lightweight heartbeat (pending job count, python binary info). |
| `GET`  | `/static/<filename>`     | Serves mastered assets produced by the Python CLI. |

- Job uploads and ffmpeg renders are staged under `tmp/uploads` and `tmp/outputs`. Files are automatically cleaned up after processing.
- Python CLI delegates DSP to ffmpeg (volume/compressor/bass/treble/limiter) and measures LUFS/true-peak via `loudnorm`.

## Python CLI usage

```bash
# Measure audio
python3 python/mastering_cli.py analyze path/to/song.wav

# Master audio with explicit parameters
python3 python/mastering_cli.py master input.wav output.wav \
  --target-lufs -14 --true-peak -1 --input-trim-db -1.5 \
  --comp-threshold -13 --comp-ratio 1.6 --attack 12 --release 80 \
  --eq-low-hz 120 --eq-low-db -0.8 --eq-low-q 0.7 \
  --eq-high-hz 3500 --eq-high-db 0.6 --eq-high-q 0.7 \
  --limiter-ceiling -1 --limiter-release 40
```

Environment variables `FFMPEG_BIN` / `FFPROBE_BIN` control which binaries are invoked.

## Build & Deployment

1. **Front-end (Vite)**
   ```bash
   npm run build          # emits production assets to /dist
   npm run preview        # optional local preview
   ```
   Deploy `/dist` to a static host (Vercel, Netlify, CloudFront, etc.). Set `VITE_*` env vars if you need to override API endpoints at build time.

2. **Back-end (Express + Python)**
   ```bash
   npm run server:build   # tsc -> dist-server
   npm run server:start   # runs dist-server/server/masteringServer.js
   ```
   Package `dist-server`, `python/`, and `.env` into a container (Cloud Run, Fly.io, Render, etc.). Ensure ffmpeg is installed in the image and expose `MASTERING_SERVER_PORT`. Recommended process manager: `node dist-server/server/masteringServer.js`.

3. **Environment management**
   - Store secrets (Gemini key, rate limits) in your platform’s secret manager.
   - Mount persistent storage or object storage if you need to keep mastered files beyond the default `/static` path.

### Static hosting + backend API

- All global styles (scrollbars, body defaults) now live in `public/index.css`. Vite copies everything under `public/` verbatim into `dist`, so the generated site always serves `/index.css` without 404s.
- The React UI assumes `/api/*` exists on the same origin unless you provide overrides.

To deploy the front-end to a static host and point it at a separately managed API:

1. Build the back-end bundle and start (or deploy) it somewhere reachable:
   ```bash
   npm run server:build
   npm run server:start         # locally this listens on MASTERING_SERVER_PORT (default 3001)
   ```
2. Note the public URL of that server (e.g. `https://mastering-api.example.com`).
3. Configure the front-end build with environment overrides:
   - `VITE_MASTERING_API_URL=https://mastering-api.example.com/api/master`
   - `VITE_MASTERING_PARAMS_API_URL=https://mastering-api.example.com/api/mastering-params`
4. Re-run `npm run build` and deploy the refreshed `dist/` output to your static host.

Alternatively, port the Express server to your platform’s serverless/runtime model (Vercel Functions, Netlify Functions, etc.) so `/api/*` is served from the same domain.

## QA & Monitoring

- **Smoke test:** validates ffmpeg + Python CLI locally without the front-end.
  ```bash
  npm run qa:smoke
  ```
  Generates a synthetic sine wave, runs `analyze` and `master`, and prints the resulting metrics JSON.

- **Health checks:** probe `/api/health` (expects `{ status: "ok" }`) and alert on non-200 responses.

- **Job telemetry:** `server/masteringServer.ts` logs every Gemini failure, CLI stderr, and job transitions. Pipe STDOUT/ERR to your log stack (Cloud Logging, Datadog, etc.) and alert on `job.status === 'error'`.

- **E2E ideas:** upload real stems through the UI, compare `finalMetrics` vs target, and archive mastered WAVs. Add monitoring on Gemini rate-limit hits via `429` responses from `/api/mastering-params`.

## Next steps

- Harden the async job store (Redis/Postgres) if you need durability across restarts.
- Attach a CDN or signed URLs to `/static` for long-lived mastered audio.
- Expand the QA suite with regression audio clips and golden metric thresholds.
