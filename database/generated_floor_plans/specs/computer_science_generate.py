"""Generate and validate the synthetic Computer Science layouts only."""
import json
from pathlib import Path
from PIL import Image

SOURCE = 'C:/Users/sortiz/.t3/userdata/attachments/c421cf06-02b7-426e-96c1-e1de5d82569d-04b618eb-7c02-4294-ba88-218d317cfea0.png'
L, R, T, B = 459, 965, 145, 837

def polygon(r):
    a,b,c,d = r
    return [[a,b],[c,b],[c,d],[a,d]]

def inside(p, poly):
    x,y=p
    result=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>y)!=(b[1]>y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            result=not result
    return result

def generate(f):
    prefix=f'{f}00'
    rooms=[]
    halls=[]
    n=f*100+1
    def room(kind, rect, side, number=None, label=None):
        nonlocal n
        x0,y0,x1,y1=rect
        dx,dy=(x0+x1)/2,(y0+y1)/2
        door={'N':[dx,y0,'N'],'S':[dx,y1,'S'],'E':[x1,dy,'E'],'W':[x0,dy,'W']}[side]
        if number is None:
            number=str(n)
            n+=1
        rooms.append(dict(number=number,type=kind,rect=rect,label=label or [dx,dy],door=door))
    def hall(rect,label=None):
        halls.append(dict(number=f'{prefix}C{len(halls)+1}',polygon=polygon(rect),label=label or [(rect[0]+rect[2])/2,(rect[1]+rect[3])/2]))
    hall([680,270,740,710],[710,370])
    hall([L,230,R,270],[800,250])
    hall([L,710,R,750],[615,730])
    room('stairs',[L,T,570,230],'S',f'{prefix}S1')
    room('restroom',[570,T,640,230],'S')
    room('elevator',[640,T,680,230],'S',f'{prefix}E1')
    room('storage',[680,T,740,230],'S',label=[710,205])
    top=rooms[-1]
    del top['rect']
    top['polygon']=[[680,T],[688,T],[688,173],[737,173],[737,T],[740,T],[740,230],[680,230]]
    room('classroom' if f<2 else 'lab' if f==2 else 'meeting',[740,T,R,230],'S')
    room('classroom' if f<2 else 'meeting',[L,750,570,B],'N')
    room('restroom',[570,750,680,B],'N')
    room('storage',[680,750,770,B],'N',label=[726,780])
    bottom=rooms[-1]
    del bottom['rect']
    bottom['polygon']=[[680,750],[770,750],[770,B],[737,B],[737,808],[688,808],[688,B],[680,B]]
    room('restroom',[770,750,850,B],'N')
    room('stairs',[850,750,R,B],'N',f'{prefix}S2')
    def bank(side, breaks, kinds):
        a,c,door=(L,680,'E') if side=='west' else (740,R,'W')
        for i,(b,d) in enumerate(zip(breaks,breaks[1:])):
            room(kinds[i%len(kinds)],[a,b,c,d],door)
    if f==0:
        bank('west',[270,380,490,600,710],['classroom'])
        bank('east',[270,400,505,615,710],['classroom','lab','classroom','meeting'])
    elif f==1:
        bank('west',[270,350,440,530,620,710],['classroom','classroom','lab'])
        bank('east',[270,340,410,485,560,635,710],['lab','classroom','classroom'])
    elif f==2:
        bank('west',[270,350,420],['lab'])
        hall([L,470,680,510],[560,490])
        for a,c in [(L,570),(570,680)]:
            room('office',[a,420,c,470],'S')
            room('office',[a,510,c,560],'N')
        bank('west',[560,635,710],['lab','meeting'])
        bank('east',[270,335,400,465,550,630,710],['lab','lab','meeting'])
    else:
        bank('west',[270,320,370,420],['office'])
        hall([L,470,680,510],[560,490])
        for a,c in [(L,570),(570,680)]:
            room('office',[a,420,c,470],'S')
            room('office',[a,510,c,560],'N')
        bank('west',[560,610,660,710],['office','office','meeting'])
        bank('east',[270,320,370],['office'])
        hall([740,420,R,460],[850,440])
        for a,c in [(740,850),(850,R)]:
            room('office',[a,370,c,420],'S')
            room('office',[a,460,c,510],'N')
        bank('east',[510,550,590,630,670,710],['office'])
    return dict(floor=f,name=['Ground Floor','First Floor','Second Floor','Third Floor'][f],spaces=rooms,corridors=halls)

data=dict(building_id='computer_science',building_name='Computer Science',source_image=SOURCE,coordinate_system='normalized full source image 0..1000, x right y down',floors=[generate(f) for f in range(4)])

def validate():
    source=Image.open(SOURCE).convert('RGB')
    def navy(pt):
        x,y=pt
        rgb=source.getpixel((int(x*source.width/1000),int(y*source.height/1000)))
        return rgb[0]<60 and rgb[2]>rgb[0]
    for floor in data['floors']:
        shapes=[s.get('polygon') or polygon(s['rect']) for s in floor['spaces']]+[c['polygon'] for c in floor['corridors']]
        assert len({s['number'] for s in floor['spaces']+floor['corridors']})==len(shapes)
        for s in floor['spaces']:
            shape=s.get('polygon') or polygon(s['rect'])
            assert inside(s['label'],shape),s
            assert navy(s['label']) and navy(s['door'][:2]),s
            x,y,side=s['door']
            delta={'N':(0,-1),'S':(0,1),'E':(1,0),'W':(-1,0)}[side]
            assert inside([x-delta[0],y-delta[1]],shape),s
            assert any(inside([x+delta[0],y+delta[1]],c['polygon']) for c in floor['corridors']),s
        # Dense sampling checks occupied interior for both gaps and overlaps.
        for x in range(461,965,3):
            for y in range(147,837,3):
                if any(x==p[0] or y==p[1] for shape in shapes for p in shape):
                    continue
                count=sum(inside([x,y],shape) for shape in shapes)
                assert count<=1,(floor['floor'],x,y,'overlap')
                in_notch=(688<=x<=737) and (y<173 or y>808)
                assert count==1 or in_notch,(floor['floor'],x,y,'gap')
        for c in floor['corridors']:
            assert navy(c['label'])
        print(f"Floor {floor['floor']}: {len(floor['spaces'])} spaces, {len(floor['corridors'])} corridors; labels, doors, coverage and overlap checks passed")
    for core in ['S1','S2','E1']:
        positions=[next(s['rect'] for s in f['spaces'] if s['number']==f"{f['floor']}00{core}") for f in data['floors']]
        assert all(p==positions[0] for p in positions)

if __name__=='__main__':
    validate()
    output=Path(__file__).with_name('computer_science.json')
    output.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    json.loads(output.read_text(encoding='utf-8'))
