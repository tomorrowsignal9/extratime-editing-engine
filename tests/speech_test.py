"""Model-independent contracts; these do NOT claim real acoustic alignment."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('speech', Path(__file__).resolve().parent.parent / 'scripts/speech.py')
speech = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)
class SpeechTests(unittest.TestCase):
    def test_normalization_retains_display_and_expands_spoken_years(self):
        display, words = speech.tokenize("In 1963, Lev Yashin won the Ballon d’Or.")
        self.assertEqual(display[1], ('1963,', 3))
        self.assertEqual(words, ['in', 'nineteen', 'sixty', 'three', 'lev', 'yashin', 'won', 'the', 'ballon', "d'or"])
    def test_grouping_uses_acoustic_times_without_interpolation(self):
        words = [{'text': str(i)+'.', 'start': i+.1, 'end': i+.5} for i in range(5)]
        groups = speech.group(words)
        self.assertEqual(len(groups), 5)
        self.assertEqual(groups[3]['words'], [words[3]])
        self.assertEqual(groups[3]['start'], 3.1)
    def test_missing_dependencies_have_manual_srt_fallback(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(speech, 'MODELS', Path(folder)), patch.object(speech.importlib.util, 'find_spec', return_value=None):
            self.assertEqual(speech.status(), {'alignment': [], 'transcription': [], 'downloadsDuringProcessing': False})
    def test_invalid_or_empty_scripts_rejected(self):
        for text in ['', '!!!', '10000']:
            with self.assertRaises(ValueError): speech.tokenize(text)
if __name__ == '__main__': unittest.main()
