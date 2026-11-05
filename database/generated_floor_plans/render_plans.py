"""Render the synthetic layouts and export their linked CSV records.

Requires Pillow and numpy. Run from any directory: python render_plans.py
"""
from pathlib import Path
import base64
import csv
import html
import hashlib
import io
import json
import math

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
NAVY = '#061773'
WALL = '#C2DFF4'
CYAN = '#25B9F1'
WHITE = '#FFFFFF'
FONT = 'C:/Windows/Fonts/arialbd.ttf'


def polygon(space):
    if 'polygon' in space:
        return space['polygon']
    x0, y0, x1, y1 = space['rect']
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def csv_write(name, rows):
    if rows:
        with (ROOT / name).open('w', newline='', encoding='utf-8') as handle:
            out = csv.DictWriter(handle, fieldnames=list(rows[0]))
            out.writeheader()
            out.writerows(rows)


class Drawing:
    def __init__(self, mask):
        self.mask = mask
        self.w, self.h = mask.size
        self.image = Image.new('RGB', mask.size, NAVY)
        self.draw = ImageDraw.Draw(self.image)
        stream = io.BytesIO()
        mask.save(stream, format='PNG')
        encoded = base64.b64encode(stream.getvalue()).decode()
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">',
                    '<defs><mask id="footprint" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style="mask-type:luminance">',
                    f'<image width="{self.w}" height="{self.h}" href="data:image/png;base64,{encoded}"/></mask></defs>',
                    f'<g mask="url(#footprint)"><rect width="100%" height="100%" fill="{NAVY}"/>']
        self.stroke = max(2, round(min(self.w, self.h) / 375))
        self.label_boxes = []
        self.label_issues = []

    def point(self, p):
        return (p[0] * self.w / 1000, p[1] * self.h / 1000)

    def line(self, pts, color=WALL, width=None):
        width = width or self.stroke
        self.draw.line(pts, fill=color, width=width, joint='curve')
        points = ' '.join(f'{x:.2f},{y:.2f}' for x, y in pts)
        self.svg.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="{width}"/>')

    def label(self, space, corridor=False):
        points = [self.point(p) for p in polygon(space)]
        xs, ys = zip(*points)
        cx, cy = self.point(space['label'])
        available_w = 2 * min(cx-min(xs), max(xs)-cx) - 4*self.stroke
        available_h = 2 * min(cy-min(ys), max(ys)-cy) - 4*self.stroke
        size = max(12, round(min(self.w, self.h) * (0.022 if corridor else 0.021)))
        text = str(space['number'])
        while size >= 7:
            font = ImageFont.truetype(FONT, size)
            box = font.getbbox(text)
            tw, th = box[2]-box[0], box[3]-box[1]
            if tw <= available_w and th <= available_h:
                actual=self.draw.textbbox((cx,cy),text,font=font,anchor='mm')
                crop=tuple(map(int,(math.floor(actual[0]),math.floor(actual[1]),math.ceil(actual[2]),math.ceil(actual[3]))))
                local=Image.new('L',(crop[2]-crop[0],crop[3]-crop[1]),0)
                ImageDraw.Draw(local).polygon([(x-crop[0],y-crop[1]) for x,y in points],fill=255)
                local=ImageChops.multiply(local,self.mask.crop(crop))
                textmask=Image.new('L',local.size,0)
                ImageDraw.Draw(textmask).text((cx-crop[0],cy-crop[1]),text,font=font,anchor='mm',fill=255)
                if not np.any((np.asarray(textmask)>0) & (np.asarray(local)==0)):
                    break
            size -= 1
        if size < 7:
            self.label_issues.append(text)
            size=7
        font = ImageFont.truetype(FONT, size)
        self.draw.text((cx,cy), text, font=font, fill=WHITE, anchor='mm', stroke_width=0)
        self.svg.append(f'<text x="{cx:.2f}" y="{cy:.2f}" fill="white" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="{size}" text-anchor="middle" dominant-baseline="central">{html.escape(text)}</text>')
        actual=self.draw.textbbox((cx,cy),text,font=font,anchor='mm')
        self.label_boxes.append({'number': text, 'font_px': size, 'box': list(actual)})

    def room(self, space):
        points = [self.point(p) for p in polygon(space)]
        self.line(points+[points[0]])
        if space['type'] in ('stairs', 'elevator'):
            xs, ys = zip(*points)
            x0,x1 = min(xs),max(xs)
            y0,y1 = min(ys),max(ys)
            if space['type'] == 'stairs':
                # Reserve the upper half for the identifier.
                for k in range(7):
                    y = y0 + (y1-y0)*(0.60 + 0.045*k)
                    self.line([(x0+(x1-x0)*.12,y),(x1-(x1-x0)*.12,y)],width=max(1,self.stroke//2))
                self.line([(x0+(x1-x0)*.26,y1-(y1-y0)*.1),(x0+(x1-x0)*.26,y0+(y1-y0)*.58)],CYAN,max(2,self.stroke*2))
            else:
                self.line([(x0+(x1-x0)*.2,y1-(y1-y0)*.12),(x1-(x1-x0)*.2,y1-(y1-y0)*.12)],CYAN,self.stroke*2)

    def door(self, space):
        x,y,side = space['door']
        x,y = self.point((x,y))
        pts = [self.point(p) for p in polygon(space)]
        xs,ys = zip(*pts)
        r = max(5,min(min(self.w,self.h)*.016,(max(xs)-min(xs))*.21,(max(ys)-min(ys))*.21))
        if side in ('N','S'):
            a,b = (x-r/2,y),(x+r/2,y)
            direction = 1 if side == 'N' else -1
            end = (a[0],y+direction*r)
            arc = [(a[0]+r*math.cos(t*math.pi/40),y+direction*r*math.sin(t*math.pi/40)) for t in range(21)]
        else:
            a,b = (x,y-r/2),(x,y+r/2)
            direction = 1 if side == 'W' else -1
            end = (x+direction*r,a[1])
            arc = [(x+direction*r*math.sin(t*math.pi/40),a[1]+r*math.cos(t*math.pi/40)) for t in range(21)]
        self.line([a,b],NAVY,self.stroke+3)
        self.line([a,end],width=max(1,self.stroke//2))
        self.line(arc,width=max(1,self.stroke//2))

    def save(self, stem):
        # Perimeter drawn inward; alpha remains the source mask exactly.
        edge = ImageChops.subtract(self.mask,self.mask.filter(ImageFilter.MinFilter(2*self.stroke+1)))
        self.image.paste(WALL,(0,0),edge)
        self.image.putalpha(self.mask)
        self.image.save(stem.with_suffix('.png'))
        stream=io.BytesIO()
        perimeter=Image.new('RGBA',self.mask.size,WALL)
        perimeter.putalpha(edge)
        perimeter.save(stream,format='PNG')
        self.svg.append(f'<image width="{self.w}" height="{self.h}" href="data:image/png;base64,{base64.b64encode(stream.getvalue()).decode()}"/></g></svg>')
        stem.with_suffix('.svg').write_text('\n'.join(self.svg),encoding='utf-8')
        return self.image


def main():
    buildings, floors, rooms, corridors, checks, previews = [],[],[],[],[],[]
    sources = sorted((ROOT/'specs').glob('*.json'))
    if len(sources) != 5:
        raise ValueError('Expected five building specs')
    for source in sources:
        spec=json.loads(source.read_text(encoding='utf-8-sig'))
        bid=spec['building_id']
        mask=Image.open(ROOT/'masks'/f'{bid}.png').convert('L')
        sw,sh=mask.size
        scale=max(2,math.ceil(2200/max(sw,sh)))
        mask=mask.resize((sw*scale,sh*scale),Image.Resampling.NEAREST)
        dest=ROOT/'plans'/bid
        dest.mkdir(parents=True,exist_ok=True)
        buildings.append({'building_id':bid,'building_name':spec['building_name'],'source_image':f'references/{bid}.png','source_sha256':hashlib.sha256((ROOT/'references'/f'{bid}.png').read_bytes()).hexdigest(),'footprint_mask':f'masks/{bid}.png','source_width_px':sw,'source_height_px':sh,'floor_count':4,'is_synthetic':'true'})
        for floor in spec['floors']:
            f=floor['floor']; fid=f'{bid}_f{f}'
            drawing=Drawing(mask)
            for s in floor['spaces']:
                drawing.room(s)
            for s in floor['spaces']:
                drawing.door(s)
            for s in floor['spaces']:
                drawing.label(s)
            for s in floor['corridors']:
                drawing.label(s,True)
            stem=dest/f'floor_{f}'
            image=drawing.save(stem)
            png=f'plans/{bid}/floor_{f}.png'; svg=f'plans/{bid}/floor_{f}.svg'
            floors.append({'floor_id':fid,'building_id':bid,'building_name':spec['building_name'],'floor_number':f,'floor_name':floor.get('display_name',floor['name']),'image_path':png,'svg_path':svg,'image_width_px':mask.width,'image_height_px':mask.height,'room_count':len(floor['spaces']),'is_synthetic':'true'})
            for collection,output in [('spaces',rooms),('corridors',corridors)]:
                for s in floor[collection]:
                    number=str(s['number']); door=s.get('door',['','',''])
                    output.append({'space_id':f'{fid}_{number}','building_id':bid,'building_name':spec['building_name'],'floor_id':fid,'floor_number':f,'room_number':number,'space_type':s.get('type','corridor'),'core_id':s.get('core_id',''),'label_x':s['label'][0],'label_y':s['label'][1],'door_x':door[0],'door_y':door[1],'door_side':door[2],'polygon_json':json.dumps(polygon(s),separators=(',',':')),'coordinate_units':'0..1000 full source canvas','image_path':png,'is_synthetic':'true'})
            alpha_ok=np.array_equal(np.asarray(image.getchannel('A')),np.asarray(mask))
            collisions=[]
            for i,a in enumerate(drawing.label_boxes):
                for b in drawing.label_boxes[i+1:]:
                    ax,ay,bx,by=a['box'];cx,cy,dx,dy=b['box']
                    if min(bx,dx)>max(ax,cx) and min(by,dy)>max(ay,cy):
                        collisions.append([a['number'],b['number']])
            checks.append({'floor_id':fid,'footprint_alpha_matches_mask':alpha_ok,'room_labels':len(floor['spaces']),'corridor_labels':len(floor['corridors']),'minimum_label_font_px':min(x['font_px'] for x in drawing.label_boxes),'label_containment_failures':drawing.label_issues,'label_collisions':collisions})
            if not alpha_ok:
                raise ValueError(f'Boundary mismatch: {fid}')
            previews.append((spec['building_name'],floor.get('display_name',floor['name']),image.copy()))
    csv_write('buildings.csv',buildings)
    csv_write('floors.csv',floors)
    csv_write('rooms.csv',rooms)
    csv_write('corridors.csv',corridors)
    (ROOT/'review'/'render_validation.json').write_text(json.dumps({'floor_count':len(floors),'room_count':len(rooms),'corridor_count':len(corridors),'checks':checks},indent=2),encoding='utf-8')
    # Local contact sheet: titles outside the artwork, source proportions retained.
    cw,ch=650,540
    sheet=Image.new('RGB',(cw*4,ch*5),'#eff2f8')
    draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype(FONT,19)
    for i,(name,fname,img) in enumerate(previews):
        x,y=(i%4)*cw,(i//4)*ch
        draw.text((x+18,y+12),f'{name} | {fname}',font=font,fill='#122747')
        img.thumbnail((cw-36,ch-75),Image.Resampling.LANCZOS)
        sheet.paste(img,(x+(cw-img.width)//2,y+52+(ch-75-img.height)//2),img)
    sheet.save(ROOT/'all_floor_plans.png')
    print(json.dumps({'buildings':len(buildings),'floors':len(floors),'rooms':len(rooms),'corridors':len(corridors),'all_footprints_match':all(c['footprint_alpha_matches_mask'] for c in checks)}))


if __name__ == '__main__':
    main()
