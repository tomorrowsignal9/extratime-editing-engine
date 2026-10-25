"""Compatibility CLI; only operator-imported local Whisper models are accepted."""
import os, subprocess, sys
from pathlib import Path
if len(sys.argv) != 3:
    raise SystemExit('Usage: transcribe.py voiceover.mp3 output.json; set WHISPER_MODEL_ID to an imported model ID')
raise SystemExit(subprocess.call([sys.executable, str(Path(__file__).with_name('speech.py')), '--mode', 'transcribe', '--audio', sys.argv[1], '--output', sys.argv[2], '--model', os.environ.get('WHISPER_MODEL_ID', 'base-en')]))
