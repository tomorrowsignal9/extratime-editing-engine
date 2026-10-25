"""Offline after first model download. CPU int8, two threads for fanless hardware."""
import sys,json,os
from faster_whisper import WhisperModel
model=WhisperModel(os.environ.get('WHISPER_MODEL','base.en'),device='cpu',compute_type='int8',cpu_threads=2,download_root=os.environ.get('WHISPER_CACHE','data/models'))
segments,_=model.transcribe(sys.argv[1],word_timestamps=True,beam_size=5,language='en')
words=[{'text':w.word.strip(),'start':w.start,'end':w.end} for s in segments for w in s.words if w.end>w.start]
captions=[]
for i in range(0,len(words),5):
 group=words[i:i+5]; captions.append({'text':' '.join(w['text'] for w in group),'start':group[0]['start'],'end':group[-1]['end']})
with open(sys.argv[2],'w') as f: json.dump({'words':words,'captions':captions},f,indent=2)
