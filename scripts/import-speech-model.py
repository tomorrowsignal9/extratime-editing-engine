"""Explicit local directory import. No URLs, network calls or implicit downloads."""
import argparse, hashlib, json, os, re, shutil
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('kind', choices=['whisper', 'pocketsphinx'])
p.add_argument('source', type=Path)
p.add_argument('name')
args = p.parse_args()
if not re.fullmatch('[a-zA-Z0-9_-]{1,80}', args.name):
    p.error('Use an alphanumeric model name.')
source = args.source.resolve()
required = ['model.bin', 'config.json', 'tokenizer.json'] if args.kind == 'whisper' else ['acoustic/' + f for f in ['mdef', 'means', 'variances', 'transition_matrices', 'sendump', 'feat.params']] + ['lexicon.dict']
if not source.is_dir() or any((not (source / r).is_file() for r in required)):
    p.error('Incomplete local model folder; see README for the required layout.')
files = list(source.rglob('*'))
if any((f.is_symlink() for f in files)):
    p.error('Model import does not accept symlinks.')
root = Path(os.environ.get('EXTRATIME_MODELS', Path(__file__).resolve().parent.parent / 'data/models'))
target = root / args.kind / args.name
if target.exists():
    p.error('Model name already exists; use a new name.')
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(source, target)
manifest = {str(f.relative_to(target)): hashlib.sha256(f.read_bytes()).hexdigest() for f in target.rglob('*') if f.is_file()}
(target / 'import-checksums.json').write_text(json.dumps(manifest, indent=2))
print('Imported local model:', args.name)
