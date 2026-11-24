"""Regression fixtures for keyed containers whose inherited ID is variable-length."""
import base64,importlib.util,json,os,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
os.environ['EFT_TARKMAP_ROOT']=str(ROOT/'work/tarkmap')
saved=sys.argv;sys.argv=['extract_gamedata.py','interchange']
spec=importlib.util.spec_from_file_location('atlas_intel',ROOT/'work/atlas/extraction/intel/extract_gamedata.py')
intel=importlib.util.module_from_spec(spec);spec.loader.exec_module(intel);sys.argv=saved

def string(value):
    data=value.encode();result=len(data).to_bytes(4,'little')+data
    return result+b'\0'*((-len(result))%4)

class ContainerDecoder(unittest.TestCase):
    def test_keyed_current_client_cash_registers(self):
        fixtures=json.loads((ROOT/'scripts/tests/fixtures/keyed-cash-registers.json').read_bytes())
        for row in fixtures:
            self.assertEqual(intel.dec_container(base64.b64decode(row['raw'])),(row['id'],row['tpl']))

    def test_empty_key_keeps_original_container_layout(self):
        cid='container_ordinary_00001';tpl='578f8778245977358849a9b5'
        payload=b'\0'*28+string('')+b'\0'*12+string(cid)+b'\0'*32+string(tpl)
        self.assertEqual(intel.dec_container(payload),(cid,tpl))

    def test_truncated_payload_does_not_invent_an_id(self):
        for payload in [b'',b'\0'*40,b'\0'*28+string('5ad7217186f7746744498875')]:
            self.assertEqual(intel.dec_container(payload)[0],None)

if __name__=='__main__':unittest.main(verbosity=2)
