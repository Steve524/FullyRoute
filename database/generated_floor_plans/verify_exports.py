"""Check saved images and CSV relationships, not just in-memory rendering."""
import csv
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent


def read(name):
    with (ROOT/name).open(newline='',encoding='utf-8') as f:
        return list(csv.DictReader(f))


def main():
    buildings=read('buildings.csv'); floors=read('floors.csv')
    rooms=read('rooms.csv'); corridors=read('corridors.csv')
    bids={x['building_id'] for x in buildings}
    fids={x['floor_id'] for x in floors}
    assert len(bids)==5 and len(fids)==20
    allspaces=rooms+corridors
    assert len({x['space_id'] for x in allspaces})==len(allspaces)
    for row in allspaces:
        assert row['building_id'] in bids and row['floor_id'] in fids
        assert (ROOT/row['image_path']).is_file()
        assert row['is_synthetic']=='true'
        assert len(json.loads(row['polygon_json']))>=3
    for floor in floors:
        bid=floor['building_id']; fid=floor['floor_id']
        expected=[r for r in allspaces if r['floor_id']==fid]
        assert len([r for r in rooms if r['floor_id']==fid])==int(floor['room_count'])
        root=ET.parse(ROOT/floor['svg_path']).getroot()
        labels=[el.text for el in root.iter() if el.tag.endswith('}text')]
        assert sorted(labels)==sorted(r['room_number'] for r in expected),fid
        image=Image.open(ROOT/floor['image_path'])
        assert image.mode=='RGBA'
        source_mask=Image.open(ROOT/'masks'/f'{bid}.png').convert('L')
        assert image.width/source_mask.width==image.height/source_mask.height
        mask=source_mask.resize(image.size,Image.Resampling.NEAREST)
        assert np.array_equal(np.asarray(image.getchannel('A')),np.asarray(mask)),fid
    render=json.loads((ROOT/'review'/'render_validation.json').read_text())
    assert all(not x['label_containment_failures'] and not x['label_collisions'] for x in render['checks'])
    specs=json.loads((ROOT/'review'/'spec_validation.json').read_text())
    assert specs['errors']==0
    report={'status':'passed','buildings':len(buildings),'floors':len(floors),'numbered_spaces':len(rooms),'corridors':len(corridors),'pngs_verified':len(floors),'svg_label_sets_match_csv':True,'png_alpha_matches_source_masks':True,'csv_keys_and_paths_valid':True,'label_collisions':0,'label_containment_failures':0,'spec_errors':specs['errors'],'spec_warnings':specs['warnings'],'warning_note':'Edge geometry is intentionally clipped to the exact building mask; see spec_validation.json.'}
    (ROOT/'review'/'export_validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':
    main()
