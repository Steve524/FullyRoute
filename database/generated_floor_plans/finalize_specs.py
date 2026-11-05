"""Normalize provenance and give floor 2 the reference's larger, sparse rooms."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    for path in sorted((ROOT/'specs').glob('*.json')):
        data=json.loads(path.read_text(encoding='utf-8-sig'))
        data['is_synthetic']=True
        data['disclosure']='Invented demonstration layout adapted to supplied building artwork; rooms are not surveyed campus data.'
        data['source_image']=f"references/{data['building_id']}.png"
        for f in data['floors']:
            f['display_name']=f['name']
            f['name']=f"Floor {f['floor']}"
            for s in f['spaces']:
                if s['type'] in ('stairs','elevator'):
                    s['core_id']=f"{data['building_id']}:core:{s['number'][3:]}"
            if f['floor'] != 2 or f.get('sparse_reference_adapted'):
                continue
            # Merge adjacent rectangular teaching bays along the same corridor.
            # The surviving doorway and label remain in their original safe position.
            for _ in range(2):
                used=set(); merged=[]
                for i,a in enumerate(f['spaces']):
                    if i in used:
                        continue
                    out=dict(a)
                    if 'rect' in a and a['type'] not in ('stairs','elevator','restroom','storage'):
                        ax,ay,bx,by=a['rect']
                        for j,b in enumerate(f['spaces'][i+1:],i+1):
                            if j in used or 'rect' not in b or b['type'] in ('stairs','elevator','restroom','storage'):
                                continue
                            cx,cy,dx,dy=b['rect']
                            horizontal=abs(ay-cy)<.01 and abs(by-dy)<.01 and (abs(bx-cx)<.01 or abs(dx-ax)<.01)
                            vertical=abs(ax-cx)<.01 and abs(bx-dx)<.01 and (abs(by-cy)<.01 or abs(dy-ay)<.01)
                            if a['door'][2]==b['door'][2] and ((horizontal and a['door'][2] in ('N','S')) or (vertical and a['door'][2] in ('E','W'))):
                                out['rect']=[min(ax,cx),min(ay,cy),max(bx,dx),max(by,dy)]
                                out['type']='lab'
                                used.add(j)
                                break
                    merged.append(out)
                f['spaces']=merged
            f['sparse_reference_adapted']=True
        path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')


if __name__ == '__main__':
    main()
