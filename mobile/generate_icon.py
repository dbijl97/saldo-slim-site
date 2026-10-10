"""Create a native Saldo Slim icon from a reproducible vector-like design."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

size=1024
im=Image.new('RGB',(size,size),'#07182A')
d=ImageDraw.Draw(im)
d.rounded_rectangle((38,38,986,986),radius=210,fill='#0C2035',outline='#E9BE62',width=18)
d.ellipse((190,225,834,869),outline='#F2CB70',width=35)
d.rectangle((300,590,365,725),fill='#F2CB70')
d.rectangle((395,500,460,725),fill='#F2CB70')
d.rectangle((490,425,555,725),fill='#F2CB70')
font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font=ImageFont.truetype(font_path,330)
d.text((565,510),'€',font=font,fill='#F2CB70',anchor='mm',stroke_width=2,stroke_fill='#F2CB70')
d.polygon([(350,270),(390,205),(455,265),(510,175),(575,265),(640,205),(680,270),(660,330),(370,330)],fill='#F2CB70')
d.ellipse((374,189,400,215),fill='#F9DB8C')
d.ellipse((497,155,523,181),fill='#F9DB8C')
d.ellipse((627,189,653,215),fill='#F9DB8C')
out=Path(__file__).parent/'assets'/'icon.png'
out.parent.mkdir(parents=True,exist_ok=True)
im.save(out,optimize=True)
print('Generated',out)
