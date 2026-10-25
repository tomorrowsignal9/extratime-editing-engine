# EXTRATIME Editing Engine

Local-first football Shorts renderer. Phase 0 passes with the supplied Episode 001 SRT; **dashboard and Phases 1–3 are not implemented yet**. No hosted inference or paid video APIs. Original supplied media stays local.

## Requirements and installation

Node.js 22+ (tested here on 24), npm, FFmpeg/ffprobe, and Chromium. On macOS: install Node.js and `brew install ffmpeg chromium`. Set `CHROME_PATH` to your Chromium executable when it is not auto-discovered. The renderer otherwise uses Remotion's browser discovery/download support.

```sh
bash scripts/setup.sh
```

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

Rendering uses concurrency=1, H.264 veryfast/CRF20, yuv420p, AAC 48kHz. This reduces fanless-laptop load, but has **not been benchmarked on M4 hardware**. Preview/UI, a process-wide job queue, batch exports, and interactive editing remain future phases. Run one CLI render at a time.

## Episode 001 SRT workflow

The supplied exact SRT is committed at `episodes/episode-001/subtitles.srt`. Its original timestamps, capitalization, punctuation, and explicit line breaks are preserved. Copy `docs/episode-001.manifest.json` to `data/projects/episode-001.json` when initializing a new checkout with the supplied original media.

```sh
npm run captions -- data/projects/episode-001.json episodes/episode-001/subtitles.srt
CHROME_PATH=/path/to/chromium RENDER_OUTPUT=outputs/episode-001-subtitled.mp4 npm run render -- data/projects/episode-001.json --proof
npm run validate -- data/projects/episode-001.json outputs/episode-001-subtitled.mp4
npm run validate:subtitles -- outputs/episode-001-subtitled.mp4
```

`validate-subtitles` is an Episode 001 acceptance check: it compares the imported/exported SRT, detects the actual burned-in caption pixels at all 14 cue midpoints and subtitle-free gaps, checks mobile-safe bounds/two-line layout, and compares phrase onsets against the source audio's silence boundaries. It does not claim automatic word-level forced alignment. See `docs/PHASE-0-STATUS.md` and committed validation reports for measured results. The previous uncaptioned proof remains at `outputs/episode-001.mp4`; the new export has a separate filename.

The prototype CLI assumes trusted local operator files. It is not a hosted upload endpoint. No web server or upload UI is provided yet. Remotion license eligibility must be evaluated for your use case.
