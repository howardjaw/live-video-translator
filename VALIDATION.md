# Validation results — 2026-11-10

- `npm run build`: passed TypeScript checking and extension bundling.
- `npm test`: 4 tests passed. Session storage, explicit remembering, migration back to session-only storage, forgetting keys, same-provider reuse, HTTPS/backend configuration, and synchronization state decisions.
- `.venv/bin/python -m pytest -q`: 24 tests passed. Includes private-address rejection, custom destination confirmation, redirect rejection and DNS pinning, error redaction/classification, provider wire formats, user-supplied credential routing, complete simulated-provider translation pipeline, cancellation, credential removal, source/model cache invalidation, segment placement, silence and overlong speech. One upstream Starlette TestClient deprecation warning; no test failures.
- `node scripts/browser-content.mjs`: passed with real Chromium media elements and the built content script. Complete mock processing, play, pause/resume, forward/backward seeking, 0.75×/1×/1.5×, synthetic waiting event, switching to original audio, source replacement, stale-job rejection. **30 normal-playback clock samples; maximum drift 0.052726 seconds (~53 ms)** on the generated eight-second fixture. This is a measured local result, not a universal guarantee or a measurement of translated word timing.

## Not verified

- `npm run browser` was attempted, but the environment's managed Chromium policy has `ExtensionInstallBlocklist: ["*"]`. No extension service worker could start. The policy was preserved. Downloading an alternate Playwright browser failed with a destination-policy 403 at `cdn.playwright.dev`.
- Full unpacked-extension installation, real Chrome popup close/reopen, permission prompts and service-worker suspension remain to be tested in a normal desktop Chrome profile. The full harness is included and can use `CHROMIUM_PATH` for an extension-capable Chromium executable. The fallback browser harness stubs Chrome messaging and does not establish these outcomes.
- Actual network buffering was not induced; a synthetic `waiting` event was tested.
- Paid API calls, account credit availability, model/voice entitlement and real spoken translation quality were not tested because no user keys were available. Tests exercise real adapters with simulated provider responses and distinct supplied sentinel keys; they are not paid-provider success claims.
- Fish and ElevenLabs API contracts were verified from their official SDK sources. Direct provider documentation domains were blocked in this environment. See PROVIDERS.md.

## Manual acceptance in desktop Chrome

1. Follow README setup and load `dist/`. Save session keys and confirm that closing/reopening the popup preserves them, while restarting Chrome clears them.
2. Opt into remembering, restart Chrome, confirm keys remain, then forget keys and verify both persisted/session stores are clear.
3. Test each configured stage. Verify wrong keys and unavailable model IDs yield actionable errors; inspect provider account limits for rate/credit scenarios.
4. For custom translation, verify a changed URL requires new confirmation; HTTP/private addresses and redirects must fail without forwarding the key.
5. Run the mock demo, close/reopen the popup during processing, and play the result. Exercise timeline controls, original audio, navigation and video removal. Run `npm run browser` for automated desktop acceptance where permitted.
6. Disable mock mode and supply your own keys. On the demo, use the generated matching file plus captions. Then test an accessible HTTPS video with speech, without captions, to exercise transcription. Verify speech meaning and alignment manually.
7. Cancel a job and restart the backend during another job. No credentials should appear in `.data/*/job.json`; interrupted jobs must require retry and key resubmission.
