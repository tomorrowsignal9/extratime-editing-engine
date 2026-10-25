"""Episode 001 test fixture: prove the original whoosh is present in the real AAC mix.
This is not a general-purpose audio-quality or licensing classifier.
"""
import array
import json
import math
import subprocess
import sys
from pathlib import Path

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/phase-2/aligned')
project = json.loads((out / 'manifest.json').read_text())
assert len(project['soundLayers']) == 1
layer = project['soundLayers'][0]
assert layer['enabled'] and layer['loop'] and layer['start'] == 8 and layer['duration'] == 3

def pcm(file):
    data = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(file), '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'])
    values = array.array('f')
    values.frombytes(data)
    return values

def rms(values):
    return math.sqrt(sum(x*x for x in values) / len(values))

def correlation(a, b):
    return sum(x*y for x, y in zip(a, b)) / math.sqrt(sum(x*x for x in a) * sum(y*y for y in b))

voice = pcm(Path('public') / project['audio'])
rendered = pcm(out / 'episode-001.mp4')
sound = pcm(Path('public') / layer['asset'])
residual = [rendered[i] - .9 * voice[i] for i in range(min(len(voice), len(rendered)))]
inside = residual[8*8000:11*8000]
expected = [sound[i % len(sound)] for i in range(len(inside))]
observed = correlation(inside, expected)
controls = [abs(correlation(residual[t*8000:(t+3)*8000], expected)) for t in [12, 16, 20, 24]]
report = {
    'method': 'Residual after subtracting 90% original narration, correlated with the repeated source whoosh. Control windows contain narration but no sound layer. AAC compression contributes residual noise.',
    'soundResidualCorrelation': observed,
    'controlCorrelations': controls,
    'insideResidualRms': rms(inside),
    'outsideResidualRms': rms(residual[12*8000:15*8000]),
    'passed': observed > 5 * max(controls),
}
(out / 'sound-verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
assert report['passed'], 'Whoosh presence was not distinguishable from control windows'
