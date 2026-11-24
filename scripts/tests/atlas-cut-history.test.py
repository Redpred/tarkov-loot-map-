import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.atlas_cut_history import merge_exclusions, verified_history, file_sha


def cut(low, high, shift=0):
    return {'id': 'same-id', 'operation': 'review-and-prune-intersecting-geometry',
            'volume': {'polygon': [{'x': x+shift, 'z': z} for x, z in [(0, 0), (2, 0), (2, 2), (0, 2)]], 'minY': low, 'maxY': high}}


class CutHistoryTests(unittest.TestCase):
    def test_expanding_current_height_does_not_restore_previously_cut_basement(self):
        old, new = cut(-20, 3), cut(-5.27, 67.5)
        snapshots = copy.deepcopy([old, new])
        result = merge_exclusions([old], [new])
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]['volume']['minY'], result[0]['volume']['maxY']), (-20, 67.5))
        self.assertEqual([old, new], snapshots)

    def test_disjoint_storeys_do_not_fill_the_gap(self):
        result = merge_exclusions([cut(0, 1)], [cut(3, 4)])
        self.assertEqual([(r['volume']['minY'], r['volume']['maxY']) for r in result], [(0, 1), (3, 4)])

    def test_moved_or_removed_selection_preserves_previous_removal(self):
        self.assertEqual(len(merge_exclusions([cut(0, 1)], [cut(0, 1, 10)])), 2)
        self.assertEqual(len(merge_exclusions([cut(0, 1)], [])), 1)

    def test_repeated_selection_is_idempotent(self):
        merged = merge_exclusions([cut(0, 1)], [cut(0, 1)])
        self.assertEqual(merge_exclusions(merged, [cut(0, 1)]), merged)

    def test_unchanged_editor_selection_preserves_reviewed_restoration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root/'model.bin').write_bytes(b'restored geometry')
            old_input = {'map':'factory', 'coordinateSystem':'unity-world-xyz', 'exclusions':[cut(-20, 67.5)]}
            input_path = root/'manual-cull-selection.json'; input_path.write_text(json.dumps(old_input))
            # The applied recipe has an underground opening absent in the editor rectangle.
            previous = {**old_input, 'exclusions':merge_exclusions([cut(-20, -5.3), cut(0.7, 67.5)], [])}
            path = root/'manual-cull-effective-selection.json'; path.write_text(json.dumps(previous))
            current = {'sha256':file_sha(root/'model.bin'), 'sceneSha256':'scene', 'binary':'model.bin',
                       'manualCull':{'sourceGeometrySha256':'baseline', 'selectionSha256':file_sha(input_path), 'effectiveSelectionSha256':file_sha(path)}}
            manifest = root/'geometry.json'; manifest.write_text(json.dumps(current))
            latest = {**old_input, 'source':{'geometrySha256':current['sha256'], 'geometryManifestSha256':file_sha(manifest), 'sceneSha256':'scene'}}
            baseline = {'sha256':'baseline', 'sceneSha256':'scene'}
            result, _ = verified_history(baseline, latest, manifest, path)
            self.assertEqual(result['exclusions'], previous['exclusions'])
            self.assertEqual(result['newOrChangedSelections'], 0)
            changed = copy.deepcopy(latest); changed['exclusions'][0]['volume']['maxY'] = 70
            result, _ = verified_history(baseline, changed, manifest, path)
            self.assertEqual(result['newOrChangedSelections'], 1)
            self.assertEqual(result['exclusions'], merge_exclusions(previous['exclusions'], changed['exclusions']))
            input_path.write_text('{}')
            with self.assertRaises(ValueError): verified_history(baseline, latest, manifest, path)

    def test_history_requires_exact_reviewed_manifest_binary_and_applied_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root/'model.bin').write_bytes(b'reviewed geometry')
            previous = {'map':'factory', 'coordinateSystem':'unity-world-xyz', 'exclusions':[cut(-20, 3)]}
            path = root/'previous.json'; path.write_text(json.dumps(previous))
            current = {'sha256':file_sha(root/'model.bin'), 'sceneSha256':'scene', 'binary':'model.bin',
                       'manualCull':{'sourceGeometrySha256':'baseline', 'selectionSha256':file_sha(path)}}
            manifest = root/'geometry.json'; manifest.write_text(json.dumps(current))
            latest = {**previous, 'exclusions':[cut(-5.27, 67.5)], 'source':{'geometrySha256':current['sha256'], 'geometryManifestSha256':file_sha(manifest), 'sceneSha256':'scene'}}
            baseline = {'sha256':'baseline', 'sceneSha256':'scene'}
            result, _ = verified_history(baseline, latest, manifest, path)
            self.assertEqual(result['exclusions'][0]['volume']['minY'], -20)
            for bad in [{**latest, 'source':{**latest['source'], 'geometryManifestSha256':'wrong'}}, {**latest, 'source':{**latest['source'], 'sceneSha256':'wrong'}}]:
                with self.assertRaises(ValueError): verified_history(baseline, bad, manifest, path)
            path.write_text(json.dumps({**previous, 'exclusions':[]}))
            with self.assertRaises(ValueError): verified_history(baseline, latest, manifest, path)
            path.write_text(json.dumps(previous)); (root/'model.bin').write_bytes(b'changed')
            with self.assertRaises(ValueError): verified_history(baseline, latest, manifest, path)


if __name__ == '__main__': unittest.main(verbosity=2)
