"""Build and validate synthetic Education Classroom layouts; source-pixel geometry."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

SOURCE = 'C:/Users/sortiz/.t3/userdata/attachments/c421cf06-02b7-426e-96c1-e1de5d82569d-3182101c-2a7d-4dec-ab7b-554645b4d7d4.png'
OUT = Path(__file__).with_name('education_classroom.json')

def point(p):
    return [round(p[0] * 1000 / 256, 3), round(p[1] * 4, 3)]

def rectpoly(r):
    x, y, X, Y = r
    return [(x,y),(X,y),(X,Y),(x,Y)]

def inside(p, poly):
    x,y=p
    result=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        cross=(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0])
        if abs(cross)<1e-7 and min(a[0],b[0])<=x<=max(a[0],b[0]) and min(a[1],b[1])<=y<=max(a[1],b[1]):
            return True
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            result=not result
    return result

# Fill enclosed white lettering to recover the silhouette for point checks.
im=Image.open(SOURCE).convert('RGB')
mask=Image.new('L',im.size)
mask.putdata([255 if b>r*1.2 and r<70 and g<100 else 0 for r,g,b in im.getdata()])
outside=mask.copy()
ImageDraw.floodfill(outside,(0,0),128)
mask.putdata([0 if v==128 else 255 for v in outside.getdata()])

floors=[]
for f in range(4):
    prefix=f'{f}00'
    raw=[]
    n=f*100+1
    def add(typ, r=None, poly=None, label=None, door=None, number=None):
        global n
        if number is None:
            number=str(n)
            n+=1
        if label is None:
            label=((r[0]+r[2])/2,(r[1]+r[3])/2)
        raw.append(dict(number=number,type=typ,r=r,poly=poly,label=label,door=door))
    corridors=[
        [(42,7),(53,7),(53,70),(112,70),(112,82),(42,82),(42,148),(30,148),(30,82),(13,82),(13,70),(42,70)],
        rectpoly((13,148,245,160)),
        rectpoly((142,117,154,248)),
        rectpoly((13,205,245,216)),
    ]
    add('stairs',(13,7,42,32),door=(42,20,'E'),number=prefix+'S1')
    add('stairs',(211,117,245,148),door=(228,148,'S'),number=prefix+'S2')
    add('elevator',(122,216,142,245),label=(132,224),door=(132,216,'N'),number=prefix+'E1')
    ys=([32,51,70] if f<2 else [32,45,58,70])
    for a,b in zip(ys,ys[1:]):
        add('office' if f>1 else 'seminar',(13,a,42,b),door=(42,(a+b)/2,'E'))
    xs=([53,82,112] if f<2 else ([53,75,94,112] if f==2 else [53,68,83,98,112]))
    for a,b in zip(xs,xs[1:]):
        add(['classroom','classroom','lab','office'][f],(a,7,b,70),door=((a+b)/2,70,'S'))
    add('seminar' if f<2 else 'office',poly=[(42,82),(112,82),(112,106),(69,106),(69,84),(52,84),(52,117),(42,117)],label=(88,94),door=(88,82,'N'))
    add('restroom',(13,82,30,117),door=(30,99,'E'))
    add('restroom',(13,117,30,148),door=(30,132,'E'))
    topwest=([42,90,142] if f==0 else [42,77,110,142] if f<3 else [42,62,82,102,122,142])
    for a,b in zip(topwest,topwest[1:]):
        add(['classroom','seminar','lab','office'][f],(a,117,b,148),door=((a+b)/2,148,'S'))
    topeast=([154,181,211] if f<2 else [154,174,192,211])
    for a,b in zip(topeast,topeast[1:]):
        add('office' if f==3 else 'lab' if f==2 else 'seminar',(a,117,b,148),door=((a+b)/2,148,'S'))
    west=[[13,76,142],[13,53,97,142],[13,45,77,110,142],[13,31,49,67,85,104,123,142]][f]
    east=[[154,199,245],[154,184,214,245],[154,181,212,245],[154,172,190,208,226,245]][f]
    for side in (west,east):
        for i,(a,b) in enumerate(zip(side,side[1:])):
            # Alternate main and cross-hall doors for readable circulation.
            edge=160 if i%2==0 else 205
            add(['lecture','classroom','lab','office'][f],(a,160,b,205),door=((a+b)/2,edge,'N' if edge==160 else 'S'))
    bottom=([52,87,122] if f<2 else [52,75,99,122])
    for a,b in zip(bottom,bottom[1:]):
        add('storage' if f<2 else 'office',(a,216,b,229),label=((a+b)/2,222),door=((a+b)/2,216,'N'))
    bottomright=([154,201,245] if f<3 else [154,177,201,222,245])
    for a,b in zip(bottomright,bottomright[1:]):
        add('office' if f>0 else 'seminar',(a,216,b,245),label=((a+b)/2,226),door=((a+b)/2,216,'N'))

    assert len({s['number'] for s in raw})==len(raw)
    assert 15<=len(raw)<=45
    for s in raw:
        poly=s['poly'] or rectpoly(s['r'])
        assert inside(s['label'],poly),s
        assert inside(s['door'][:2],poly),s
        assert any(inside(s['door'][:2],c) for c in corridors),s
        for p in (s['label'],s['door']):
            assert mask.getpixel((int(p[0]),int(p[1])))==255,(f,s['number'],p)
    # No room interiors overlap each other or the connected corridor system.
    for y in range(7,248):
        for x in range(13,245):
            p=(x+.5,y+.5)
            occupants=[s['number'] for s in raw if inside(p,s['poly'] or rectpoly(s['r']))]
            assert len(occupants)<=1,(f,p,occupants)
            assert not occupants or not any(inside(p,c) for c in corridors),(f,p,occupants)
    spaces=[]
    for s in raw:
        entry={'number':s['number'],'type':s['type']}
        if s['r']:
            entry['rect']=point(s['r'][:2])+point(s['r'][2:])
        else:
            entry['polygon']=[point(p) for p in s['poly']]
        entry['label']=point(s['label'])
        entry['door']=point(s['door'][:2])+[s['door'][2]]
        spaces.append(entry)
    floors.append({'floor':f,'name':['Ground Floor','First Floor','Second Floor','Third Floor'][f],'spaces':spaces,'corridors':[{'number':prefix+'C'+str(i+1),'polygon':[point(p) for p in c],'label':point([(47.5,47),(101,154),(148,181),(99,210.5)][i])} for i,c in enumerate(corridors)]})

result={'building_id':'education_classroom','building_name':'Education Classroom','source_image':SOURCE,'coordinate_system':'normalized full source image 0..1000, x right y down','floors':floors}
OUT.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
assert json.loads(OUT.read_text())==result
print('Validated spaces per floor:',[len(f['spaces']) for f in floors])
print('Stable cores, unique numbering, corridor doors, inside-footprint labels, and non-overlapping interiors verified.')
