import sys, glob, os
from PIL import Image, ImageDraw
O='/Volumes/Sohail/AI_Projects/RunningApps/adoptme-jan7/scripts/pet-cards/hd-art/out'
keys=sys.argv[2:]; S=220; cols=4
rows=(len(keys)+cols-1)//cols
c=Image.new('RGB',(cols*(2*S+12), rows*(S+22)),(255,255,255)); d=ImageDraw.Draw(c)
for i,k in enumerate(keys):
    x=(i%cols)*(2*S+12); y=(i//cols)*(S+22)
    ref=glob.glob(f'{O}/kit2/{k}.png') or glob.glob(f'{O}/remaster_kit/*_{k}.png')
    if ref: c.paste(Image.open(ref[0]).convert('RGBA').resize((S,S)).convert('RGB'),(x,y+20))
    try:
        new=Image.open(f'{O}/1024/{k}.webp').convert('RGBA').resize((S,S))
        bg=Image.new('RGBA',(S,S),(70,45,110,255)); bg.alpha_composite(new); c.paste(bg.convert('RGB'),(x+S,y+20))
    except Exception: d.text((x+S+10,y+100),'missing',fill=(255,0,0))
    d.text((x+4,y+4),k,fill=(0,0,0))
c.save(sys.argv[1])
