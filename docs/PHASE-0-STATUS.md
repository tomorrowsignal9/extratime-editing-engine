# Phase 0 — PASS

Episode 001 now renders successfully with the supplied English SRT, the original five images, and the complete original voiceover. The existing Remotion renderer and scene timing were retained. This is technical rendering acceptance; the manifest remains an editorial review copy (`approved: false`). Phase 1 has not started.

## Deliverables

- MP4: `outputs/episode-001-subtitled.mp4` (23,825,571 bytes).
- Exported SRT and project JSON: `outputs/episode-001-subtitled.srt`, `outputs/episode-001-subtitled.json`.
- Supplied SRT: `episodes/episode-001/subtitles.srt` (all 14 original cues, exact text, timestamps, punctuation, capitalization and explicit line breaks retained).
- Working manifest: `data/projects/episode-001.json`; committed copy: `docs/episode-001.manifest.json`.
- Representative MP4 frames: `outputs/subtitle-frames/cue-01.png` through `cue-14.png`.
- The prior uncaptioned proof remains at `outputs/episode-001.mp4`.
- Media and generated exports remain local and gitignored; the SRT, manifest, validation reports, and contact sheet are committed.

MP4 SHA-256: `f5d5659d1c15fb049de868b631ffe77a473da0ca55d1a14be4e3426cbeabe5a8`.

## Actual validation results

| Check | Result |
| --- | --- |
| Format | PASS — 1080×1920, 30 FPS, H.264, yuv420p, BT.709, AAC 48 kHz |
| Duration | PASS — original MP3 30.275875s; video timeline 30.3s / 909 frames; MP4 container 30.315000s |
| Audio synchronization | PASS — decoded source/output correlation 0.9999772973, without applying an alignment shift |
| Final half-second audio | PASS — source RMS 0.0047061859, output RMS 0.0046939423; narration not truncated |
| Original assets | PASS — all five JPEGs and VO.mp3 match the uploaded ZIP byte-for-byte; SHA-256 records retained |
| SRT import/export | PASS — all 14 cues match the supplied SRT including explicit two-line layout |
| Burned-in subtitles | PASS — actual caption pixels present at every cue midpoint; maximum two lines; within mobile-safe bounds |
| Subtitle gaps | PASS — no caption pixels in eight sampled SRT pauses |
| Phrase timing against VO | PASS — nine post-pause phrase starts agree with source waveform onsets within 8.957ms (less than one 30fps frame) |
| Final cue | PASS — “WHO'S NEXT?” at 29.320–30.270s, visible in final frame 908 at 30.2667s |
| Blank-frame checks | PASS — all 909 frames scanned with FFmpeg blackdetect; zero black intervals; representative frame luminance/variance checks pass |
| Unit tests | PASS — 11 tests, 0 failures |
| Typecheck / lint | PASS — `npm run typecheck`, `npm run lint` |
| Rendering validation | PASS — `npm run validate` and `npm run validate:subtitles` on the final MP4 |

Timing review uses the supplied exact SRT as the text/timing source and compares independent phrase starts with original VO silence boundaries (-35 dB, minimum 150ms). It does not claim new word-level transcription or forced alignment. The continuous phrase-internal cues retain the user's supplied timings. Display boundaries are quantized to 30fps, so cue appearance can differ from SRT milliseconds by less than one frame.

## Visual inspection

Inspected final MP4 frames for cues 1, 6, 8, 10, 13, and 14 at mobile width. Captions remain legible, fit within two lines, and avoid faces and the trophy ball. Explicit SRT line breaks are preserved. Caption styling uses 42px bold type, high-contrast lime on a dark backing, 90px left / 150px right margins, and a 64% vertical anchor. The longest cue initially wrapped to three lines; reducing the font resolved it. Raising the anchor from 72% avoids the opening trophy. No source image, scene duration, animation, voiceover speed, or SRT timestamp was changed.

![Representative frames from the final subtitled MP4](validation/episode-001-contact-sheet.jpg)

## Reproduce

```sh
npm run captions -- data/projects/episode-001.json episodes/episode-001/subtitles.srt
CHROME_PATH=/usr/bin/chromium RENDER_OUTPUT=outputs/episode-001-subtitled.mp4 npm run render -- data/projects/episode-001.json --proof
npm run validate -- data/projects/episode-001.json outputs/episode-001-subtitled.mp4
npm run validate:subtitles -- outputs/episode-001-subtitled.mp4
npm run lint
npm run typecheck
npm test
```

The browser path above is for this Linux environment; use the installed Chromium path on macOS. Rendering was tested on Linux, not benchmarked on an M4 MacBook Air.

Automatic Whisper transcription is deferred to Phase 2 and is not a Phase 0 prerequisite. No model download or network-permission expansion was attempted for this task. Standard setup no longer installs Whisper dependencies. Dashboard, interactive preview and later production phases remain outside this delivery.

Detailed evidence: [acceptance](validation/episode-001-acceptance.json), [media](validation/episode-001-subtitled.validation.json), [subtitle and timing](validation/episode-001-subtitle-validation.json), [source integrity](validation/episode-001-source-integrity.json).
