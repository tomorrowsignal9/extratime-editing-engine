# EXTRATIME Editing Engine — MVP V1

Version: 1.0 · Product: EXTRATIME Studio · Audience: owner-operated global football Shorts channel

## Purpose

Produce original, polished vertical YouTube Shorts from user-provided stills/clips, voiceover and optional transcript; minimize recurring video-generation spend while preserving editorial review and authenticity. This is a **local-first production tool**, not an AI video model, and does not generate realistic human motion from static photos.

## Guiding goals

1. Import 5–10 9:16 JPG/PNG/WebP still images or authorized MP4 footage, and MP3/WAV voiceover.
2. Auto-extract voiceover duration via ffprobe; generate a proposed shot timeline and editable sentence/phrase-boundary cuts.
3. Generate English subtitles with word timestamps when an optional local transcriber is installed; also support user-supplied SRT and manual caption editing. Never pretend fabricated word timing is exact.
4. Preview actual motion in a web UI via Remotion Player, not a nonrepresentative mock.
5. Apply cinematic presets: Documentary, Fast Viral, Legendary Stories. Support scene-by-scene effect choices, zoom focal points, speed and duration overrides.
6. Export 1080x1920 30fps H.264 video with AAC audio, plus SRT and project JSON.
7. One-click export after editorial approval, with progress and failure logs; no YouTube upload in MVP.
8. Handle rendering on an M4 MacBook Air without assuming unlimited resources or always-on background execution.

## Content rules

- Every video must provide original and substantive narrative or educational value; do not mass-publish interchangeable slide shows.
- Do not download or use broadcast match footage, copyrighted commercial music, photos, or logos without suitable rights.
- Flag realistic historical reenactments for synthetic-media disclosure at publishing stage.
- Require human approval before final export. UI must not claim 'copyright safe', 'monetizable', or 'viral guaranteed'.

## MVP user flow

Create Project > Import Assets > Analyze VO > Edit Timeline > Review Captions > Preview > Approve > Render > Download.

### Screens

- **Projects:** create/import/open, status and output actions.
- **Editor:** asset bin on left, portrait preview center, inspector right, audio-waveform + scene timeline below.
- **Render:** background job queue (one concurrent local job), progress, cancel and error diagnostics.
- **Settings:** frame-rate (default 30), resolution, output folder, performance mode, captions, SFX/music levels.

## Technical design

- Node.js 22 + TypeScript, Next.js, Tailwind CSS, Zod validation.
- Remotion + `@remotion/player` for preview and template-based motion; `@remotion/transitions` for transitions, `@remotion/captions` for subtitle display.
- FFmpeg / ffprobe for validation, media metadata, normalization/encoding; Remotion Node renderer/CLI for video output.
- Store project manifests and local media in a configurable workspace folder; use SQLite only if clearly justified.
- One render worker process (concurrency=1), queue with state `queued|running|succeeded|failed|cancelled` and durable logs.
- Optional local transcription provider (e.g. whisper.cpp), with user-selectable model and explicit performance disclosure. Must have no-service fallback to imported SRT / manual timing.
- Never process uploaded media via hosted inference by default; no API keys required for core functionality.
- Don't run long render jobs inside Vercel serverless functions. Vercel is optional only for future UI; local background render worker remains the source of truth.
- Preview uses a lightweight 360x640 or 540x960 canvas and reduced image assets; final 1080x1920 encoding only when exporting.

## Manifest example

```json
{
  "projectId": "extratime-001",
  "title": "The Only Goalkeeper to Win the Ballon d'Or",
  "fps": 30,
  "width": 1080,
  "height": 1920,
  "voiceover": "assets/VO.mp3",
  "preset": "football-documentary",
  "captions": "assets/captions.srt",
  "scenes": [
    {"id":"s01", "asset":"assets/scene-01.jpeg", "startMs":0, "endMs":3600, "motion":"slow-push", "focal":{"x":0.5,"y":0.65}},
    {"id":"s02", "asset":"assets/scene-02.jpeg", "startMs":3600, "endMs":8100, "motion":"portrait-slide", "focal":{"x":0.5,"y":0.5}},
    {"id":"s03", "asset":"assets/scene-03.jpeg", "startMs":8100, "endMs":15000, "motion":"year-reveal", "focal":{"x":0.5,"y":0.48}},
    {"id":"s04", "asset":"assets/scene-04.jpeg", "startMs":15000, "endMs":25800, "motion":"action-zoom", "focal":{"x":0.6,"y":0.46}},
    {"id":"s05", "asset":"assets/scene-05.jpeg", "startMs":25800, "endMs":30300, "motion":"trophy-push", "focal":{"x":0.5,"y":0.6}}
  ]
}
```

Illustrative timings above are initial estimates only. Must be validated/edited against actual VO; total composition duration must include full narration and not silently cut off its final word. Transitions must not accidentally shorten the total to less than voiceover duration.

## Caption standards

- Word or short-phrase captions (max about 2 lines), legible on mobile.
- User-adjustable vertical safe area; avoid bottom/right Shorts interaction UI, never cover faces or trophy.
- Highlight spoken word only when word timestamps exist; otherwise phrase captions with editable range.
- Caps and punctuation must match source; AI transcripts require review.

## Motion standards

- Images: Ken Burns pan/zoom using subpixel smooth easing; keep focus subject within crop bounds.
- Real parallax ONLY when separate alpha foreground/background layers exist. Otherwise do not advertise faux parallax as actual depth segmentation.
- Narrative-specific transitions: short cut, fade, push/whip, restrained camera flash, historical film effect.
- Generated stills must not unexpectedly morph faces or fabricate movement; use original pixels.
- SFX default OFF if input license is unknown; use licensed or original SFX. Optional ducking under VO.

## Performance and quality

- Preview: resolution <= 540x960, paused when tab not active, avoid continuous GPU rendering when user isn't playing.
- Render: one active render, process memory and CPU limits/config. Export 1080x1920 at 30fps, H.264 yuv420p, AAC 48kHz, `-movflags +faststart` when applicable.
- Use ffprobe to validate input/output durations, video width/height, fps, existence of audio, and last 0.5 seconds not accidentally black or silent.
- Preserve exact asset identity; avoid mirrored crops unless explicitly selected.

## Scope exclusions (V1)

- Generative realistic animation of player bodies, automatic scraping of highlights, upload to YouTube, full team account roles, heavy 3D, Vercel video encoding, mandatory paid APIs, AI news research and automatic factual claims.

## Phased delivery

**Phase 0 — Verified prototype:** five Lev Yashin stills + VO, one working Remotion composition, local render, 1080x1920 output, project manifest and checks.

**Phase 1 — Editor UI:** upload assets, reorder scenes, timeline handles, inspector, preview, caption import/edit, one-click render.

**Phase 2 — Smart assistance:** optional on-device transcription/forced alignment and beat suggestions, reusable sports templates, sound mix presets.

**Phase 3 — Scale:** queue/batch exports, performance metrics, optional cloud rendering if economically justified, YouTube metadata export; publishing remains gated by human review.

## Acceptance tests

1. App boots locally with one setup command and no paid account or cloud API key.
2. Five portrait images and MP3 accepted; MIME/size validated.
3. ffprobe extracts VO duration within 100ms.
4. User can reorder and trim scene clips while preserving exact VO playback.
5. Subtitle SRT imports and displays correctly; manual corrections persist.
6. Timeline prevents negative durations and shows overlap semantics for crossfades.
7. Preview visual sequence matches rendered output at sampled key frames.
8. One-click render produces playable 1080x1920 H.264 + AAC MP4, 30fps.
9. Final video covers the full VO and does not truncate 'Who's next?'.
10. Unknown/corrupt media produces helpful error messages, not a blank UI.
11. Render error recovery works; queue limits concurrency to one.
12. Mac does not render continuously when editor is idle.
13. New episode imports with no code edits; project data drives visuals.
14. No stock clips or match footage appear unless supplied by the user with relevant rights.
15. Quality-control checklist forces manual review before marking video as export-approved.

## Reality check

Cost per episode can be close to zero for the **editing stage** using local hardware, not necessarily zero for images, voiceover, licensing, electricity, or paid Remotion licensing if user/company is not eligible for the free license. Animation of actual humans from still photographs is **not** included.
