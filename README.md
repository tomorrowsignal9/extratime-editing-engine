# EXTRATIME STUDIO

A local-first football Shorts editor built with Next.js, TypeScript, Tailwind and Remotion. The Phase 1 dashboard extends the validated Phase 0 renderer; Phase 2 adds local speech assistance, reviewable editing suggestions, sound layers and QC. See the Phase 2 status report for measured acceptance and remaining verification limits. Images, voiceovers, project metadata and exported videos stay on your machine. No database, cloud account, paid AI API or Whisper model is required.

## Run locally

Install Node.js 22+, npm, Python 3.10+, FFmpeg/ffprobe and a Chromium-based browser. On macOS, `brew install ffmpeg` provides the media tools; an existing Google Chrome installation can serve as the render browser.

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
npm test                 # TypeScript + Python tests; no Episode 001 binaries/models required
npm run lint
npm run typecheck
npm run build

# With Episode 001 media present and a local server already running:
CHROME_PATH=/path/to/chromium npm run test:e2e
# To test a production server on another port:
STUDIO_URL=http://127.0.0.1:3001 CHROME_PATH=/path/to/chromium npm run test:e2e
```

Browser acceptance tests use actual uploads and the real renderer, exercise refresh/draft recovery, two-tab conflicts, invalid uploads, replacements, drag/drop, cancellation, renderer failure/retry, concurrency rejection, MP4 download and preview/export pixel comparison. They take several minutes and create local test projects/jobs. They deliberately remove and restore **one isolated test project's** media file to exercise render failure. They do not modify the original Episode 001 files.

Evidence is documented in [Phase 1 status](docs/PHASE-1-STATUS.md) and [Phase 2 status](docs/PHASE-2-STATUS.md). The Phase 0 CLI workflow remains supported. Batch production is outside this release.

---

## Import an episode

```sh
npm run import:project -- episode-002 "Your title" /path/VO.mp3 /path/scene-01.jpeg /path/scene-02.jpeg
```

This detects voiceover duration with ffprobe, rounds up to a 30fps frame boundary, normalizes images with Sharp, and writes `data/projects/episode-002.json`. Asset references are relative to `public/`. Existing project IDs are rejected. An optional `SRT_FILE=/path/captions.srt` imports captions. Image order is argument order. No audio speed change or truncation is applied.

## Phase 2: local speech setup and smart editing

All speech processing is optional. Missing dependencies/weights produce an actionable error and leave the saved timeline/captions unchanged. Manual SRT import and editing remain available. Rendering never downloads speech weights. The dashboard reports only locally available models; it never accepts arbitrary browser-supplied model paths.

**Explicit optional setup:** PocketSphinx includes a small English acoustic model in its package (about 30 MB, rather than a large Whisper model). This command installs it; do not run it unless you want that setup/download:

```sh
bash scripts/setup-alignment.sh
.venv/bin/python scripts/speech.py --status
```

For fully offline setup, install the pinned wheels from your own wheel directory (`.venv/bin/pip install --no-index --find-links /local/wheels -r requirements-alignment.txt`). An optional custom PocketSphinx English model folder contains `acoustic/` (mdef, means, variances, transition_matrices, sendump, feat.params) and `lexicon.dict`:

```sh
.venv/bin/python scripts/import-speech-model.py pocketsphinx /local/model-folder football-en
```

Offline Whisper uses a **CTranslate2 faster-whisper model directory**, not a whisper.cpp GGUF file or a remote model name. Install the pinned runtime explicitly, then import weights you already have:

```sh
.venv/bin/pip install -r requirements-stt.txt
.venv/bin/python scripts/import-speech-model.py whisper /local/whisper-ct2-folder base-en
.venv/bin/python scripts/speech.py --status
```

The Whisper folder must contain `model.bin`, `config.json`, and `tokenizer.json`, plus the model's other configuration files. Import copies local files into `data/models/<kind>/<name>` and records checksums; it rejects symlinks and existing names. Dependencies can also be installed from offline wheels. `EXTRATIME_MODELS` overrides the operator-controlled model root; `EXTRATIME_PYTHON` selects a Python interpreter (default `.venv/bin/python`). Whisper is CPU int8 with two threads. No model is bundled in Git. If a source build is needed, install your platform’s C compiler. This cloud environment required `CC=gcc CXX=g++ bash scripts/setup-alignment.sh` because its inherited `CC=clang` pointed to a missing compiler; source builds default to two parallel jobs.

In the dashboard:

1. In **Smart editing**, paste/import the exact English narration script, then save. Script text persists with the project and browser draft. Generate a caption suggestion with the installed local aligner. Without a script, select offline Whisper when its imported weights are available. Suggestions do not replace saved captions until **Apply caption suggestion** is clicked; revisions reject stale results from another tab.
2. PocketSphinx constrains decoding to the exact script, then performs acoustic state alignment. It derives times from the audio, not from SRT timestamps or evenly divided words. Display punctuation and numeric text are retained; spoken English numbers are expanded for alignment. Write numbers in their spoken form if the narration uses an alternate pronunciation. Unknown names require explicit phonemes in `config/football-pronunciations.json`, or use SRT. This is an English dictionary-based aligner; incorrect scripts, accents, noise and unknown names can reduce accuracy. Its structural checks are **not calibrated accuracy scores**. Listen and review every result.
3. Choose documentary box, minimal text, spoken-word underline or kinetic emphasis. Word effects require real word times plus timing review. When timing is unreviewed/flagged, captions remain readable phrases. Edit individual words/times under **Edit every word and timestamp**; editing resets review. Editing a whole phrase clears its word times to avoid highlighting stale text.
4. **Suggest scene timing & motion** uses sentence boundaries, pauses and narration keywords, then shows before/after values. Accept explicitly to update the timeline. These are deterministic heuristics, not image recognition. Image order and the complete voiceover are preserved. Camera settings remain manually editable.
5. Import locally owned/licensed WAV/MP3 effects or music with category, license and attribution. CC BY requires attribution. Whoosh, impact, riser, stadium and music layers use the same audio component in preview/export; no commercial sound library is bundled. Add/enable each layer explicitly, set timing, loop and level. Disabling a layer removes it from playback/export. Gains are capped by measured source peak and narration RMS, divided across active layers, ducked 80% during captioned narration with attack/release fades, and conservatively ducked throughout if there are no captions. Enabled sounds reserve headroom by playing narration at 90% gain; narration duration/speed never changes.
6. Export runs caption geometry QC before rendering and full media QC after the existing renderer/validation. **QC report** returns machine-readable JSON: invalid/overlapping times, mobile-safe text bounds using the actual caption component, full narration coverage, expected streams, whole-video black-frame scan and clipping. Caption text must fit within x=75–945, y=480–1600 in the 1080×1920 frame, at most two lines. Adjust font/position or split long cues when QC fails. These checks catch obvious defects, not factual errors, editorial quality or every kind of artifact.

Speech and dashboard rendering share a single compute lock. Preview remains the same Remotion `Film` composition, with no transcription while idle. Speech is synchronous local analysis with a four-minute timeout; failed analysis releases the lock and does not overwrite the project. CLI commands remain operator-controlled: do not run them concurrently with the dashboard worker.

For Episode 001, `episodes/episode-001/narration.txt` is **only the concatenated text of the supplied exact English SRT**, not a separately supplied script. Alignment receives that text and the original MP3; existing SRT timestamps are not alignment inputs.

```sh
mkdir -p outputs/phase-2
.venv/bin/python scripts/speech.py --mode align \
  --audio public/media/episode-001/VO.mp3 \
  --script episodes/episode-001/narration.txt --model bundled-en-us \
  --output outputs/phase-2/alignment.json
npm run captions -- data/projects/episode-001.json outputs/phase-2/alignment.json
# Or preserve manual SRT:
npm run captions -- data/projects/episode-001.json episodes/episode-001/subtitles.srt

# Real acceptance must require a model; without it the alignment browser case is skipped:
REQUIRE_ALIGNMENT=1 STUDIO_URL=http://127.0.0.1:3001 npm run test:e2e
# Run all browser cases in ONE invocation; they share local worker/artifact storage.
npm run qc -- data/projects/episode-001.json outputs/episode-001-subtitled.mp4
# Episode 001 independent timing anchors and actual encoded word highlights:
npx tsx scripts/validate-alignment.ts outputs/phase-2/alignment.json
npx tsx scripts/validate-kinetic.ts outputs/phase-2/aligned/manifest.json outputs/phase-2/aligned/episode-001.mp4
python3 scripts/verify-sound-fixture.py outputs/phase-2/aligned
```

`scripts/make-sound-fixture.py` generates an original deterministic synthetic whoosh for tests, dedicated to CC0. It is not a stadium recording. The sound license entered by the user is retained in project/job manifests; the app cannot independently establish the rights to uploaded content.

## Render and verify

```sh
CHROME_PATH=/path/to/chromium npm run render -- data/projects/episode-002.json --proof
npm run validate -- data/projects/episode-002.json outputs/episode-002.mp4
```

Proof renders allow unapproved manifests for editorial review. Before final rendering, review rights, factual accuracy, synthetic reenactment disclosure, all captions/timestamps, crop focus, and full narration including final words; then set `approved: true` and omit `--proof`. For CLI use, approval is an explicit manifest flag; dashboard export has its own review checkbox. Files are written under `outputs`: MP4, SRT, project JSON, and validation report. Render logs report real frame/encoding progress. Existing same-ID exports are overwritten; keep prior versions elsewhere before rerendering.

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
