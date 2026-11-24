"""Run the offline suite from any working directory."""
from pathlib import Path
import sys
import unittest

here = Path(__file__).resolve().parent
sys.path.insert(0, str(here))
result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover(str(here / "tests")))
sys.exit(0 if result.wasSuccessful() else 1)
