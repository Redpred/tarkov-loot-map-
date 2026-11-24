"""Spatially partition original instanced geometry without changing its coordinates or shape."""
import argparse, hashlib, json, math
from pathlib import Path
import numpy as np


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--directory',required=True)
    p.add_argument('--name',default='streets')
    p.add_argument('--size',type=float,default=96)
    a=p.parse_args()
    directory=Path(a.directory)
    source=json.loads((directory/f'{a.name}-geometry.json').read_text(encoding='utf-8'))
    output=directory/'sectors';output.mkdir(parents=True,exist_ok=True)
    binary=np.memmap(directory/source['binary'],dtype=np.uint8,mode='r')
    sectors={}
    try:
        for mi,mesh in enumerate(source['meshes']):
            matrices=np.ndarray((mesh['instances'],12),'<f4',buffer=binary,offset=mesh['matrixOffset'])
            boxes=np.ndarray((mesh['instances'],6),'<f4',buffer=binary,offset=mesh['boundsOffset'])
            centers=(boxes[:,:3]+boxes[:,3:])/2
            cells=np.floor(centers[:,[0,2]]/a.size).astype(np.int32)
            for cell in np.unique(cells,axis=0):
                selected=np.flatnonzero(np.all(cells==cell,axis=1))
                key=f's_{cell[0]}_{cell[1]}'
                if key not in sectors:
                    sectors[key]={'id':key,'cell':cell.tolist(),'handle':(output/f'{key}.bin').open('wb'),
                        'meshes':[],'min':np.full(3,np.inf),'max':np.full(3,-np.inf),'materials':set(),'instances':0,'triangles':0}
                sector=sectors[key];handle=sector['handle']
                record={k:v for k,v in mesh.items() if not k.endswith('Offset')}
                record['instances']=len(selected)
                # Copy vertex/UV/color/index blocks exactly, and only split the instance rows.
                attrs=[('positionOffset',mesh['vertices']*12),('uvOffset',mesh['vertices']*8),('paintOffset',mesh['vertices']*4),('indexOffset',mesh['indices']*4)]
                for attr,length in attrs:
                    record[attr]=handle.tell();handle.write(binary[mesh[attr]:mesh[attr]+length])
                record['matrixOffset']=handle.tell();handle.write(matrices[selected].tobytes())
                record['boundsOffset']=handle.tell();handle.write(boxes[selected].tobytes())
                sector['min']=np.minimum(sector['min'],boxes[selected,:3].min(axis=0))
                sector['max']=np.maximum(sector['max'],boxes[selected,3:].max(axis=0))
                sector['materials'].add(mesh['material']);sector['instances']+=len(selected)
                sector['triangles']+=len(selected)*mesh['indices']//3;sector['meshes'].append(record)
            if mi%2000==0:print(f'[sectors] {mi}/{len(source["meshes"])} mesh groups',flush=True)
    finally:
        for s in sectors.values():s['handle'].close()
    records=[]
    for key,s in sorted(sectors.items()):
        file=output/f'{key}.bin'
        with file.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
        record={'id':key,'cell':s['cell'],'file':f'sectors/{key}.json','binary':f'sectors/{key}.bin','sha256':digest,
            'bounds':{'min':s['min'].tolist(),'max':s['max'].tolist()},'materialIds':sorted(s['materials']),
            'stats':{'bytes':file.stat().st_size,'exportedInstances':s['instances'],'instancedTriangles':s['triangles'],'meshGroups':len(s['meshes'])}}
        (output/f'{key}.json').write_text(json.dumps({**record,'meshes':s['meshes']},separators=(',',':')),encoding='utf-8')
        records.append(record)
    if sum(r['stats']['exportedInstances'] for r in records)!=source['stats']['exportedInstances']:
        raise RuntimeError('Sector split lost or duplicated instances')
    index={k:v for k,v in source.items() if k not in ('meshes','binary','sha256')}
    index.update(schemaVersion=3,sectorSize=a.size,sectors=records,sourceGeometrySha256=source['sha256'])
    index['stats']={**source['stats'],'sectorCount':len(records),'sectorBytes':sum(r['stats']['bytes'] for r in records)}
    (directory/f'{a.name}-sectors.json').write_text(json.dumps(index,separators=(',',':')),encoding='utf-8')
    print(json.dumps(index['stats']),flush=True)


if __name__=='__main__':main()
