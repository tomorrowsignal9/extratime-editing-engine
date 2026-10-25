# EXTRATIME STUDIO

A local-first football Shorts editor built with Next.js, TypeScript, Tailwind and Remotion. Phase 1 adds a working browser dashboard to the validated Phase 0 renderer. Images, voiceovers, project metadata and exported videos stay on your machine. No database, cloud account, paid AI API or Whisper model is required.

## Run locally

Install Node.js 22+, npm, FFmpeg/ffprobe and a Chromium-based browser. On macOS, `brew install ffmpeg` provides the media tools; an existing Google Chrome installation can serve as the render browser.

```sh
npm ci
# macOS example; use the actual browser path on your machine:
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run dev
```

Open `http://127.0.0.1:3000` in your browser. Linux validation used `CHROME_PATH=/usr/bin/chromium`. If `CHROME_PATH` is omitted, Remotion may download a compatible browser on first export. This is a browser binary, not an AI model.

For a production build running on your own computer:

```sh
npm run build
npm start
```

Both servers bind to loopback by default. This is a local single-user app, not a hosted multi-user service. Codex Cloud is only the development/test machine: neither its server process nor its files should be assumed to provide permanent application hosting. Clone the repository and run the commands above locally. There is no Vercel rendering function or hosted storage dependency.

## Editor workflow

1. Create a project with a title. Upload JPG/PNG/WebP images, an MP3/WAV voiceover, and an SRT. Image limits are 20 MB/file and 40 megapixels; audio is 80 MB and 0.2–300 seconds; SRT is 1 MB. A multipart request is limited to 100 MB.
2. Images plus audio produce a frame-aligned timeline covering the entire voiceover. SRT timestamps and explicit line breaks are preserved. Invalid imports roll back without changing the project.
3. Play, pause, restart or seek the portrait preview. The Player uses the **same `Film` component and scene manifest as the MP4 renderer**, including motion, focal coordinates, caption styles and transition parameters. Preview is capped at 320px wide in the dashboard and pauses when hidden/offscreen. There is no independent preview animation implementation.
4. Drag scenes or use the arrow buttons to reorder them. Editing a scene duration transfers frames to/from its neighbour, preserving total narration duration. Select a scene to edit camera movement, focus, intensity, pan direction and transitions. Presets apply actual scene values: Documentary, Fast Viral and Legendary Stories. Edit SRT text/times in the subtitle track.
5. Save explicitly. Dirty edits are also cached in the browser for recovery after refresh; navigation prompts before leaving unsaved edits. Revision checks reject stale saves from another tab. The last successful save remains intact on validation failure.
6. Review the preview, captions, timing and media rights, tick the approval checkbox, then export. The button starts the existing `scripts/render.ts` in a detached local worker. The worker renders an immutable saved snapshot and validates the result before marking success. Progress comes from the renderer; verification is a separate state. Only one dashboard render runs at a time, even across tabs or server processes sharing the same storage root.
7. Download the completed MP4 from Exports. Failed jobs retain diagnostics; resolve the issue and export again. Cancel stops an active render process group. Closing the browser does not cancel an active worker, but shutting down the machine will stop it.

Moving a project to Trash hides it without deleting its media. Restore it from Projects → Trash. Old/replaced media and export snapshots are retained intentionally for recovery. Permanent disk cleanup is manual in this MVP: shut down the application/worker and back up the folders before removing local data.

## Storage and architecture

- `app/components/Studio.tsx`: dashboard and editing UI; `Preview.tsx`: Remotion Player and visibility pause handling.
- `src/studio/storage.ts`: atomic JSON storage, revisions, isolated media ingestion and soft deletion.
- `src/studio/timeline.ts`: deterministic presets and frame-preserving timing operations.
- `src/studio/jobs.ts`, `scripts/studio-worker.ts`: one active export, immutable snapshots, real progress, cancel, verification and recovery of dead render jobs.
- `app/api/studio/[...path]/route.ts`: local project/upload/job API. Browser mutations require a matching local origin; filenames are generated UUIDs, references are checked for project ownership, and media signatures are decoded rather than trusting filename extensions.
- `app/media/[...path]/route.ts`: bounded public-media access with real-path containment and HTTP range support for audio.
- `src/engine/Video.tsx`, `scripts/render.ts`: shared Phase 0 composition and existing rendering pipeline. New scene fields are optional; old manifests retain their previous motion/transition defaults.
- Metadata: `data/studio/projects/*.json`. Jobs: `data/studio/jobs/<job-id>/` (manifest, MP4, SRT, validation JSON, job state and diagnostics).
- Uploaded originals/previews: `public/media/studio-<project-id>/`. Browser-supplied filesystem paths are never used as upload destinations.

`STUDIO_ROOT` can relocate metadata/jobs (default `data/studio`); keep `public/media` alongside the app and back up both locations. Run commands from the repository root. For an intentionally configured local reverse proxy, `STUDIO_ORIGIN` sets the exact allowed browser origin; the default accepts only loopback hosts. The application has no internet-facing authentication and should remain a local tool.

The renderer uses one frame-rendering worker and H.264 `veryfast` encoding. M4 thermal/battery performance has not been benchmarked; there is no claim of a measured M4 speedup. Do not run the standalone CLI renderer concurrently with dashboard exports: the dashboard lock coordinates dashboard workers, not external CLI commands.

## Episode 001 and validation

The supplied media is local and gitignored. After a fresh clone, copy the original Episode 001 images and `VO.mp3` into `public/media/episode-001/`. The dashboard then offers **Import Episode 001**, which makes an isolated project copy while preserving the baseline timing. Alternatively upload your own assets through Create Project; no code edits are needed.

```sh
npm test                 # 18 unit/storage tests; no Episode 001 binary assets required
npm run lint
npm run typecheck
npm run build

# With Episode 001 media present and a local server already running:
CHROME_PATH=/path/to/chromium npm run test:e2e
# To test a production server on another port:
STUDIO_URL=http://127.0.0.1:3001 CHROME_PATH=/path/to/chromium npm run test:e2e
```

Browser acceptance tests use actual uploads and the real renderer, exercise refresh/draft recovery, two-tab conflicts, invalid uploads, replacements, drag/drop, cancellation, renderer failure/retry, concurrency rejection, MP4 download and preview/export pixel comparison. They take several minutes and create local test projects/jobs. They deliberately remove and restore **one isolated test project's** media file to exercise render failure. They do not modify the original Episode 001 files.

Evidence is documented in [Phase 1 status](docs/PHASE-1-STATUS.md). The Phase 0 CLI workflow below remains supported. Whisper and other automatic editing/transcription assistance are deferred to Phase 2; batch production is outside this release.

---

## Import an episode

```sh
npm run import:project -- episode-002 "Your title" /path/VO.mp3 /path/scene-01.jpeg /path/scene-02.jpeg
```

This detects voiceover duration with ffprobe, rounds up to a 30fps frame boundary, normalizes images with Sharp, and writes `data/projects/episode-002.json`. Asset references are relative to `public/`. Existing project IDs are rejected. An optional `SRT_FILE=/path/captions.srt` imports captions. Image order is argument order. No audio speed change or truncation is applied.

## Optional local speech-to-text — deferred to Phase 2

This optional integration is not required for Phase 0 and has not been end-to-end validated. The standard setup installs no Whisper packages or models. Use the supplied SRT for Episode 001.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-stt.txt
.venv/bin/python scripts/transcribe.py public/media/episode-002/voiceover.mp3 data/transcript.json
npm run captions -- data/projects/episode-002.json data/transcript.json
```

The first run downloads the public `base.en` Whisper model (~150 MB) from Hugging Face; subsequent runs use `data/models` locally. `WHISPER_MODEL` accepts a local model path or supported model ID. CPU int8 inference uses two threads. Raw word timestamps are retained in the transcript JSON; display captions group five recognized words. These are model estimates requiring human review, not forced-aligned ground truth. Set `WHISPER_MODEL` to an already-downloaded model directory to operate offline.

Alternative: `npm run captions -- data/projects/episode-002.json /path/captions.srt`. Manually edit text, start/end seconds, scene durations, focal coordinates, and motion in project JSON. Changes must preserve narration duration. Overlapping/out-of-bounds captions and invalid scene durations fail validation.

## Render and verify

```sh
CHROME_PATH=/path/to/chromium npm run render -- data/projects/episode-002.json --proof
npm run validate -- data/projects/episode-002.json outputs/episode-002.mp4
```

Proof renders allow unapproved manifests for editorial review. Before final rendering, review rights, factual accuracy, synthetic reenactment disclosure, all captions/timestamps, crop focus, and full narration including final words; then set `approved: true` and omit `--proof`. Approval is manual in this prototype, not a dashboard checklist. Files are written under `outputs`: MP4, SRT, project JSON, and validation report. Render logs report real frame/encoding progress. Existing same-ID exports are overwritten; keep prior versions elsewhere before rerendering.

The sample supplied in this session is at `public/media/episode-001/`, with `data/projects/episode-001.json`. Source assets and generated files are gitignored. `docs/episode-001.manifest.json` retains the captioned configuration; copy it into `data/projects` only when initializing a new checkout with the supplied assets. Output length is 30.3 seconds to retain the full 30.276-second recording.

## Motion and performance

Remotion is the source of rendered frames. Deterministic eased push/pull, pan, punch, cut, fade and slide transitions preserve timeline length. Fades overlay the incoming scene over the extended outgoing scene; they do not subtract narration time. Optional `foreground` points to a separately supplied transparent PNG for layered parallax; no automatic segmentation is claimed. Caption color and vertical safe area are configurable.

Rendering uses concurrency=1, H.264 veryfast/CRF20, yuv420p, AAC 48kHz. This reduces fanless-laptop load, but has **not been benchmarked on M4 hardware**. The dashboard provides preview, interactive editing and one active render; batch production remains deferred. Run one CLI render at a time.

## Episode 001 SRT workflow

The supplied exact SRT is committed at `episodes/episode-001/subtitles.srt`. Its original timestamps, capitalization, punctuation, and explicit line breaks are preserved. Copy `docs/episode-001.manifest.json` to `data/projects/episode-001.json` when initializing a new checkout with the supplied original media.

```sh
npm run captions -- data/projects/episode-001.json episodes/episode-001/subtitles.srt
CHROME_PATH=/path/to/chromium RENDER_OUTPUT=outputs/episode-001-subtitled.mp4 npm run render -- data/projects/episode-001.json --proof
npm run validate -- data/projects/episode-001.json outputs/episode-001-subtitled.mp4
npm run validate:subtitles -- outputs/episode-001-subtitled.mp4
```

`validate-subtitles` is an Episode 001 acceptance check: it compares the imported/exported SRT, detects the actual burned-in caption pixels at all 14 cue midpoints and subtitle-free gaps, checks mobile-safe bounds/two-line layout, and compares phrase onsets against the source audio's silence boundaries. It does not claim automatic word-level forced alignment. See `docs/PHASE-0-STATUS.md` and committed validation reports for measured results. The previous uncaptioned proof remains at `outputs/episode-001.mp4`; the new export has a separate filename.

The CLI accepts trusted local operator paths. The browser dashboard uses isolated managed assets. Remotion license eligibility must be evaluated for your use case.
