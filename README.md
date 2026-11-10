# Video Translator · bring your own keys

A Chrome Manifest V3 / TypeScript extension and local Python FastAPI backend. It preprocesses an accessible prerecorded video into a complete audio track before translated playback. Simplified Chinese is the default target. Original audio—including music—is muted while the translated track plays.

## Run locally

Requirements: Python 3.12+, Node 22+, FFmpeg and ffprobe on PATH, desktop Chrome 120+.

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
npm ci
npm run build
bash scripts/demo.sh
.venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log
```

Load `dist/` using **chrome://extensions → Developer mode → Load unpacked**. Open extension settings and save the localhost backend permission. Set up the three provider stages or enable **Deterministic mock demo**. Visit `http://localhost:8000/demo/` in Chrome, open the extension, select the video, and click **Translate video**. When ready, click **Play translated**, then the on-page playback button. The second click gives the page a browser user gesture for audio playback.

Mock mode uses clearly labeled tones, not AI translation. The local generated test-pattern video and authored caption text are CC0; `bash scripts/demo.sh` reproduces the sample without external media downloads. For real-provider testing, disable mock mode, configure keys and a stock voice, and supply `demo/sample.mp4` through the matching-file control. Confirm it corresponds to the selected video. Loaded demo captions supply the text; the original audio is a test tone.

## Provider settings

- **Speech recognition:** OpenAI `whisper-1`, using verbose JSON segment timestamps. Other models must support that response format. Used only if timestamped captions are unavailable.
- **Translation:** OpenAI chat completions (default `gpt-4o-mini`) or a custom OpenAI-compatible **text** endpoint. Enter its HTTPS base URL, model, and explicitly confirm the exact destination. A `/v1` suffix is needed when the server uses it. Custom transcription and custom TTS are intentionally not inferred from text compatibility.
- **Text-to-speech:** Fish Audio (default adapter, `s2.1-pro`), ElevenLabs (for example `eleven_multilingual_v2`), or OpenAI (for example `gpt-4o-mini-tts`, voice `alloy`). Enter a stock voice/reference ID available in your account. Fish and ElevenLabs voice IDs are account/catalog dependent; none is invented or silently selected.

Each stage has a masked key, reveal button, and **Save & test connection**. Tests perform a small real request using the selected model, and can incur charges. The same-provider reuse selector copies the chosen key at job submission. Changing provider clears that stage's input. There is no fallback to a different paid provider. Errors distinguish authentication/permission, model/voice/request compatibility, rate limits, insufficient credits, and connectivity; provider response bodies are not exposed.

Account access and current model availability must be checked with your own key. No live provider credentials were available during implementation. Official SDK API verification is recorded in [PROVIDERS.md](PROVIDERS.md).

## Credentials and privacy

Keys live in trusted extension contexts. Default storage is `chrome.storage.session` (Chrome session, not popup lifetime). **Remember on this device** uses `chrome.storage.local`; this is **not an encrypted secrets vault**. Neither keys nor settings use Chrome sync. Content scripts receive audio and video identity, never credentials. Keys are not included in URLs, job records, or cache identities. **Forget saved keys** clears both stores; an already-running job retains its submitted credentials until completion/cancellation.

Starting a job sends the selected keys, source media URL or uploaded media, captions and stage settings to the configured backend. Connection tests send keys and small test input. The backend sends each key only to that stage's selected provider. Source audio goes to transcription when needed, text/context to translation, and translated text to TTS. Provider retention and billing follow your account's terms.

Remote backends require HTTPS; HTTP is accepted only for explicitly enabled localhost development. This MVP backend is designed for a single trusted local user and **has no multi-user authentication**. Do not expose it publicly. A remote deployment requires authentication, per-user data isolation, and request-size enforcement at its reverse proxy. Local-model endpoints are not supported; enabling local development permits only the backend, never private-network custom provider destinations.

Credentials exist only in memory for queued/running processing. A restart marks interrupted jobs failed and requires resubmission; no raw key is saved to disk. Optional developer fallback requires `ALLOW_ENV_CREDENTIALS=1` and exported variables described in `.env.example`; normal users need no environment files. Python cannot guarantee cryptographic memory erasure. This implementation drops references rather than claiming secure zeroization.

## Sources and limits

Supports accessible, non-DRM, direct **HTTPS** media URLs and explicitly confirmed matching local media files. The backend needs independent access; cookies are never exported. Protected media, `blob:` sources, adaptive manifests, live streams, unavailable media and inaccessible captions are not bypassed. An unsupported source can use a matching file if the selected video's duration is known. The HTML5 detection function is the current site adapter boundary.

Remote URLs and custom endpoints reject credentials, query strings, fragments, nonstandard ports, all redirects, and private/non-global IP addresses. DNS results are validated and the selected IP is pinned with hostname TLS verification, preventing DNS rebinding. Rejection of query-bearing URLs intentionally excludes signed media URLs in this MVP. There is no tab capture. Limits: 50 MB per source/custom-endpoint response, 10-minute video, 500 segments, 8 queued jobs, 2 processing jobs. Multipart uploads additionally need a reverse-proxy hard body limit for remote deployments. Media commands time out after 90 seconds; provider calls after 90 seconds (custom requests 60 seconds).

FFmpeg opens downloaded/uploaded input with only `file,pipe` protocols. Input duration must match within max(0.5 seconds, 2%). Overlapping or invalid captions produce an actionable failure rather than a misleading ready state.

## Architecture and timing

`extension/src/content.ts` detects videos and owns playback. `background.ts` orchestrates extension/backend messages. `settings.ts` handles storage and selection. `backend/providers.py` implements explicit provider adapters; `security.py` constrains outbound URLs; `media.py` aligns speech; `app.py` manages jobs.

Selections are snapshotted at submission, independent of later settings changes. Per-job JSON records are durable, contain no keys, and survive popup/service-worker closure. The extension retains job references and their original backend. Cancellation drops credentials and temporary media. Failed/interrupted work must be retried with current keys. Completed audio/metadata remain in `.data`; delete that directory with the backend stopped to clear retained jobs and cache.

The cache uses a content hash, caption hash, language, provider/model/voice selections and pipeline version. It is scoped to this single-user local backend. Translation receives full surrounding segment text; a too-long utterance is retried once with shorter faithful phrasing. FFmpeg applies pitch-preserving `atempo` up to 1.25×, uses adjacent silence, and fills remaining time with silence. Unfittable speech fails rather than truncating. Timeline output has exact 24 kHz sample length; encoding boundaries are checked with a 30 ms interval tolerance.

Video time is authoritative. A 50 ms control loop and media events pause audio during pause/seeking/buffering, match playback speed, and hard-correct drift over 100 ms. Seek completion realigns before resume. Source replacement/removal and page exit release audio/listeners; original mute and volume are restored. Browser autoplay failures surface an on-page retry control. Player-clock alignment is different from translated words fitting their segment windows.

## Validation

```sh
npm run build
npm test
.venv/bin/python -m pytest -q
# With the backend running and /usr/bin/chromium installed:
npm run browser
# When managed policy blocks extension installation, test content/media only:
node scripts/browser-content.mjs
```

The browser harness loads the real built extension in Chromium with the localhost host permission pregranted in a temporary test manifest (equivalent to approving settings). It runs the deterministic pipeline, closes/reopens the UI, plays audio, pauses/resumes, seeks both ways, tests 0.75×/1×/1.5× speed, switches to original audio, replaces the source, and samples actual video/audio clocks in the isolated extension world. It asserts maximum sampled normal-playback drift below 150 ms and prints measurements. Real network buffering and paid-provider output require separate manual tests. See [VALIDATION.md](VALIDATION.md) for actual results and remaining gaps.
