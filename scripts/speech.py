"""Explicit local-only speech processing. Never downloads model weights.
Alignment uses PocketSphinx constrained acoustic decoding, then state alignment.
Whisper requires an operator-imported CTranslate2 model directory.
"""
import argparse, importlib.util, json, os, re, subprocess, sys, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
MODELS = Path(os.environ.get('EXTRATIME_MODELS', ROOT / 'data/models'))

def status():
    align = []
    whisper = []
    if importlib.util.find_spec('pocketsphinx'):
        align.append({'id': 'bundled-en-us', 'label': 'PocketSphinx English (bundled, offline)'})
        for p in sorted((MODELS / 'pocketsphinx').glob('*')):
            if (p / 'acoustic/mdef').is_file() and (p / 'lexicon.dict').is_file():
                align.append({'id': p.name, 'label': p.name})
    for p in sorted((MODELS / 'whisper').glob('*')):
        if all(((p / f).is_file() for f in ['model.bin', 'config.json', 'tokenizer.json'])):
            whisper.append({'id': p.name, 'label': p.name})
    return {'alignment': align, 'transcription': whisper if importlib.util.find_spec('faster_whisper') else [], 'downloadsDuringProcessing': False}

def number(n):
    small = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
    tens = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split()
    if n < 20:
        return small[n]
    if n < 100:
        return tens[n // 10] + (' ' + small[n % 10] if n % 10 else '')
    if 1900 <= n < 2000:
        return number(n // 100) + ' ' + (number(n % 100) if n % 100 else 'hundred')
    if n < 1000:
        return small[n // 100] + ' hundred' + (' ' + number(n % 100) if n % 100 else '')
    if n < 10000:
        return small[n // 1000] + ' thousand' + (' ' + number(n % 1000) if n % 1000 else '')
    raise ValueError('Spell numbers above 9999 in words before aligning.')

def tokenize(text):
    display = []
    spoken = []
    for token in text.split():
        parts = re.findall("[a-z]+(?:'[a-z]+)*|[0-9]+", token.lower().replace('’', "'"))
        words = []
        for part in parts:
            words.extend(number(int(part)).split() if part.isdigit() else [part])
        if words:
            display.append((token, len(words)))
            spoken.extend(words)
    if not spoken or len(spoken) > 800:
        raise ValueError('Use a nonempty English script of at most 800 words.')
    return (display, spoken)

def group(words):
    captions = []
    pending = []
    for w in words:
        if pending and (len(pending) >= 4 or len(' '.join((x['text'] for x in pending + [w]))) > 38 or w['start'] - pending[-1]['end'] > 0.35):
            captions.append({'text': ' '.join((x['text'] for x in pending)), 'start': pending[0]['start'], 'end': pending[-1]['end'], 'words': pending})
            pending = []
        pending.append(w)
        if re.search('[.!?]["\\\']?$', w['text']):
            captions.append({'text': ' '.join((x['text'] for x in pending)), 'start': pending[0]['start'], 'end': pending[-1]['end'], 'words': pending})
            pending = []
    if pending:
        captions.append({'text': ' '.join((x['text'] for x in pending)), 'start': pending[0]['start'], 'end': pending[-1]['end'], 'words': pending})
    return captions

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--mode', choices=['align', 'transcribe'])
    parser.add_argument('--audio')
    parser.add_argument('--script')
    parser.add_argument('--model', default='bundled-en-us')
    parser.add_argument('--output')
    args = parser.parse_args()
    if args.status:
        print(json.dumps(status()))
        return
    if not re.fullmatch('[a-zA-Z0-9_-]{1,80}', args.model):
        raise ValueError('Invalid model identifier.')
    available = status()['alignment' if args.mode == 'align' else 'transcription']
    if args.model not in [m['id'] for m in available]:
        raise ValueError('Local speech model unavailable. Run explicit setup or import local weights; manual SRT remains available.')
    source = Path(args.audio)
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source), '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'])
    duration = len(pcm) / 32000
    if duration > 300:
        raise ValueError('Voiceover exceeds 300 seconds.')
    warnings = []
    if args.mode == 'align':
        from pocketsphinx import Decoder
        text = Path(args.script).read_text()
        display, spoken = tokenize(text)
        options = {'lm': None, 'samprate': 16000, 'loglevel': 'ERROR'}
        if args.model != 'bundled-en-us':
            folder = MODELS / 'pocketsphinx' / args.model
            options.update(hmm=str(folder / 'acoustic'), dict=str(folder / 'lexicon.dict'))
        decoder = Decoder(**options)
        for word, phones in json.loads((ROOT / 'config/football-pronunciations.json').read_text()).items():
            if not decoder.lookup_word(word):
                decoder.add_word(word, phones, False)
        unknown = sorted(set((w for w in spoken if not decoder.lookup_word(w))))
        if unknown:
            raise ValueError('Unknown pronunciation(s): ' + ', '.join(unknown) + '. Add explicit pronunciations to config/football-pronunciations.json, or import SRT.')
        decoder.set_align_text(' '.join(spoken))

        def decode():
            decoder.start_utt()
            decoder.process_raw(pcm, no_search=False, full_utt=True)
            decoder.end_utt()
        decode()
        decoder.set_alignment()
        decode()
        aligned = [{'text': re.sub(r'\(\d+\)$', '', w.name), 'start': w.start / 100, 'end': (w.start + w.duration) / 100, 'score': w.score} for w in decoder.get_alignment() if w.name not in ('<s>', '</s>', '<sil>', '(NULL)')]
        if [w['text'] for w in aligned] != spoken:
            raise ValueError('Alignment did not cover the complete script. Review the script/audio or use SRT.')
        words = []
        cursor = 0
        for token, count in display:
            selected = aligned[cursor:cursor + count]
            cursor += count
            words.append({'text': token, 'start': selected[0]['start'], 'end': min(duration, selected[-1]['end'])})
        provenance = {'method': 'pocketsphinx-forced-alignment', 'model': args.model, 'scriptSha256': hashlib.sha256(text.encode()).hexdigest(), 'timingResolutionMs': 10}
    else:
        from faster_whisper import WhisperModel
        model = WhisperModel(str(MODELS / 'whisper' / args.model), device='cpu', compute_type='int8', cpu_threads=2, num_workers=1, local_files_only=True)
        segments, _ = model.transcribe(str(source), language='en', word_timestamps=True, beam_size=5, temperature=0)
        words = [{'text': w.word.strip(), 'start': w.start, 'end': min(duration, w.end), 'confidence': w.probability} for s in segments for w in s.words]
        if any((w.get('confidence', 1) < 0.65 for w in words)):
            warnings.append('Some recognized words have low model probability; review before enabling highlighting.')
        provenance = {'method': 'faster-whisper-local', 'model': args.model}
    if not words:
        raise ValueError('No speech was aligned/transcribed.')
    for i, w in enumerate(words):
        if w['end'] <= w['start'] or (i and w['start'] < words[i - 1]['end'] - 0.001):
            raise ValueError('Speech model returned invalid or overlapping word timings. Use SRT or correct the script.')
        if w['end'] - w['start'] < 0.04 or w['end'] - w['start'] > 2:
            warnings.append('Unusually short or long word alignment; inspect timing before highlighting.')
    reliable = not warnings
    result = {'captions': group(words), 'words': words, 'duration': duration, 'reliable': reliable, 'warnings': sorted(set(warnings)), 'provenance': {**provenance, 'audioSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'requiresReview': True}}
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(json.dumps({'words': len(words), 'captions': len(result['captions']), 'reliable': reliable, 'warnings': result['warnings']}))
if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(2)
