"""Preserve the documented text estimate across ASCII and Unicode histories."""
import importlib.util
from pathlib import Path
import random
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('usage_estimate_hub', ROOT / 'hub.py')
hub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hub)


class TextEstimateTests(unittest.TestCase):
    def test_ascii_rounding_and_non_ascii_codepoints(self):
        for text, expected in [('', 0), ('a', 1), ('abcd', 1), ('abcde', 2),
                               ('中文', 2), ('协作abcd🙂', 4), ('e\u0301', 2),
                               ('\x00\n\x7f\x80', 2), ('\ud800', 1)]:
            with self.subTest(text=repr(text)):
                self.assertEqual(hub.board_text_estimate(text), expected)

    def test_unicode_samples_preserve_documented_formula(self):
        rng = random.Random(20260918)
        alphabet = [chr(i) for i in range(128)] + ['中', '文', '🙂', '𐐀', '\u0301', '\ud800']
        for length in (0, 1, 3, 4, 5, 240, 4000, 32000):
            text = ''.join(rng.choice(alphabet) for _ in range(length))
            non_ascii = sum(ord(char) > 127 for char in text)
            self.assertEqual(hub.board_text_estimate(text), non_ascii + (length - non_ascii + 3) // 4)
