"""Original deterministic synthetic whoosh for reproducible tests (CC0). Not a stadium recording."""
import math, random, struct, wave
from pathlib import Path
random.seed(9)
rate = 48000
length = 0.8
out = Path('outputs/phase-2/original-whoosh.wav')
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(rate)
    smooth = 0
    data = []
    for i in range(int(rate * length)):
        t = i / rate
        smooth = 0.92 * smooth + 0.08 * random.uniform(-1, 1)
        envelope = math.sin(math.pi * t / length) ** 2
        data.append(struct.pack('<h', round(12000 * smooth * envelope)))
    wav.writeframes(b''.join(data))
print(out)
