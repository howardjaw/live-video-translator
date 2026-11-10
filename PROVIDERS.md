# Provider API verification

Verified 2026-11-10 against official provider SDK source. Direct documentation hosts were blocked by this cloud environment's outbound policy; official GitHub sources were accessible. No account credentials were present, so account/model/voice entitlement is unverified.

## Fish Audio

Official SDK: https://github.com/fishaudio/fish-audio-python

Inspected commit `30d271311566b7516911234ad1d25ff65b3594ec`:
- `src/fishaudio/resources/tts.py`: POST `/v1/tts`; MessagePack request body, `Content-Type: application/msgpack`, `model` header; `text`, `reference_id`, `format` fields.
- `src/fishaudio/core/client_wrapper.py`: base URL `https://api.fish.audio`, `Authorization: Bearer …`.
- `src/fishaudio/types/shared.py`: current model literals include `s2.1-pro`; TTS helper uses it by default.

Adapter uses the documented synchronous complete response, not websocket streaming or voice cloning. User must choose an authorized stock reference ID. No enterprise-only feature requested.

## ElevenLabs

Official generated SDK:
https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/text_to_speech/client.py
https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/text_to_speech/raw_client.py

Inspected `convert` and raw request: POST `/v1/text-to-speech/{voice_id}` with `text`, `model_id`; standard API key authentication uses `xi-api-key`. Standard default MP3 output avoids higher-tier PCM/high-bitrate requirements. The adapter does not request enterprise-only zero-retention mode. Stock voice and model entitlement are checked through an actual test synthesis, not assumed.

## OpenAI

Explicit adapters use `/v1/audio/transcriptions` (`whisper-1`, verbose segment timestamps), `/v1/chat/completions`, and `/v1/audio/speech`. Custom OpenAI-compatible endpoints use only chat completions. Endpoint/model compatibility and credits are surfaced through test requests; there is no paid fallback.
