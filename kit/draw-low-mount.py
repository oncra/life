import math
W,H = 1340, 1240
S = 0.255
INK="#111111"; MID="#555555"; LIGHT="#9a9a94"; PAPER="#fcfcfb"
BLUE="#2a78d6"; ORANGE="#eb6834"; GREEN="#1baf7a"
o=[]; A=o.append
def esc(t): return t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def txt(x,y,t,s=11,f=INK,a="start",w="400",halo=True):
    h=f' stroke="{PAPER}" stroke-width="3.2" paint-order="stroke"' if halo else ""
    A(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{s}" fill="{f}" text-anchor="{a}" font-weight="{w}"{h}>{esc(t)}</text>')
def line(x1,y1,x2,y2,c=INK,w=1.4,d=None):
    A(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{c}" stroke-width="{w}"'
      f'{f" stroke-dasharray=\'{d}\'" if d else ""} stroke-linecap="round"/>')
def rect(x,y,w,h,f="none",st=INK,sw=1.4,d=None):
    A(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{f}" stroke="{st}" stroke-width="{sw}"'
      f'{f" stroke-dasharray=\'{d}\'" if d else ""}/>')
def poly(pts,f="none",st=INK,sw=1.4):
    A(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)}" fill="{f}" stroke="{st}" stroke-width="{sw}"/>')
def circ(x,y,r,f=INK,st="none",sw=1):
    A(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{f}" stroke="{st}" stroke-width="{sw}"/>')
def dimv(x,y1,y2,label):
    line(x,y1,x,y2,MID,1)
    for y in (y1,y2): line(x-4,y,x+4,y,MID,1)
    txt(x-7,(y1+y2)/2+4,label,10,MID,"end")
def lead(x1,y1,x2,y2,label):
    line(x1,y1,x2-6,y2,LIGHT,1); circ(x1,y1,2.4,LIGHT)
    txt(x2,y2+3.5,label,10.5,INK,"start")

A(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">')
A(f'<defs><pattern id="soil" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
  f'<line x1="0" y1="0" x2="0" y2="9" stroke="{LIGHT}" stroke-width="1"/></pattern>'
  f'<pattern id="cell" width="7" height="7" patternUnits="userSpaceOnUse">'
  f'<rect width="7" height="7" fill="{BLUE}" opacity="0.16"/><line x1="0" y1="0" x2="0" y2="7" stroke="{BLUE}" stroke-width="0.6" opacity="0.45"/></pattern></defs>')
A(f'<rect width="{W}" height="{H}" fill="{PAPER}"/>')
txt(40,34,"Life node v1 - low-profile field mount",17,INK,"start","600")
txt(40,54,"Sits inside a standing crop. Nothing stands above 1090 mm: the microphone and the 4G antenna are both inside the box. All dimensions in mm.",11.5,MID)
line(40,66,1300,66,LIGHT,1)
line(672,86,672,1155,LIGHT,1)

# ===================== VIEW A =====================
GX, GY = 212, 620
mx=lambda v: GX+v*S; my=lambda v: GY-v*S
txt(40,100,"A   Side elevation, from the east",12.5,INK,"start","600")
A(f'<rect x="40" y="{GY:.0f}" width="600" height="185" fill="url(#soil)" opacity="0.8"/>')
# crop behind
A('<g opacity="0.30">')
for i in range(19):
    xx=48+i*19; hh=980+(i%6)*80
    line(xx,GY,xx-7,GY-hh*S,GREEN,1.1); line(xx,GY,xx+6,GY-(hh-120)*S,GREEN,1.1)
A('</g>')
txt(52,GY-1130*S,"standing crop",9.5,GREEN,"start","600")
line(40,GY,640,GY,INK,1.8); txt(44,GY+16,"grade",9.5,MID)
pw=60*S
rect(mx(0)-pw/2,my(1140),pw,(1140+800)*S,"#ffffff",INK,1.6)
line(mx(0)-pw/2,GY,mx(0)+pw/2,GY,INK,1.6)
for yy in (-250,-500): line(mx(0)-pw/2-8,my(yy),mx(0)+pw/2+8,my(yy),MID,1.2)
bd,bh=130*S,200*S; bx,by=mx(0)-pw/2-bd,my(700)
rect(bx,by,bd,bh,"#ffffff",INK,1.8); rect(bx+3,by+3,bd-6,bh-6,"none",LIGHT,0.8)
ang=math.radians(40); p0=(mx(10),my(755))
p1=(p0[0]-510*S*math.cos(ang), p0[1]-510*S*math.sin(ang))
n=(13*S*math.sin(ang), -13*S*math.cos(ang))
poly([p0,p1,(p1[0]+n[0],p1[1]+n[1]),(p0[0]+n[0],p0[1]+n[1])],"url(#cell)",INK,1.6)
line(p0[0]-8,p0[1]+2,mx(0)-pw/2,my(680),MID,1.2)
line((p0[0]+p1[0])/2,(p0[1]+p1[1])/2+5,bx+4,my(705),MID,1.2)
# microphone port in the box wall, behind an acoustic membrane
circ(bx+bd/2, my(760)+3, 5, "#ffffff", GREEN, 1.8)
poly([(bx+bd/2-9,my(760)-4),(bx+bd/2+9,my(760)-4),(bx+bd/2,my(760)+14)],"none",GREEN,1.3)
line(mx(0)-pw/2,my(530),mx(-300),my(530),ORANGE,1.6)
line(mx(-300),my(530),mx(-300),my(-130),ORANGE,1.6)
line(mx(-300),my(-130),mx(-620),my(-130),ORANGE,1.6)
txt(mx(-470),my(-200),"to probes, 3 m",9.5,ORANGE,"middle","600")
dimv(mx(-160),my(0),my(500),"500")
dimv(mx(-160),my(500),my(700),"200")
dimv(mx(-300),my(0),my(1090),"1090")
dimv(mx(250),GY,my(-800),"800")
CL=418
for (px,py,lab,ly) in [
 (p1[0]+26,p1[1]+20,"100 Wp panel at 40° south. Doubles as the",150),
 (None,None,"box's sunshade and rain cap",164),
 (bx+bd/2,my(760)+3,"microphone port: 5 mm hole, acoustic",206),
 (None,None,"membrane behind it, foam hood over it",220),
 (bx+bd/2,my(630),"4G stick radiates through the plastic wall.",262),
 (None,None,"No external antenna, no mast",276),
 (bx+bd/2,by+bh/2,"IP65 box 300 x 200 x 130, base 500 up",318),
 (mx(0),my(140),"60 x 60 post, 800 driven. No concrete",354),
 (mx(-300),my(-130),"probe cable in a 120 slit, turf closed over",390)]:
    if px is None: txt(CL,ly+3.5,lab,10.5,INK,"start")
    else: lead(px,py,CL,ly,lab)

# ===================== VIEW B =====================
BX,BY=830,352; sb=S*0.47
fx=lambda v: BX+v*sb; fy=lambda v: BY-v*sb
txt(700,100,"B   Front elevation, from the south",12.5,INK,"start","600")
A(f'<rect x="{fx(-640):.0f}" y="{BY:.0f}" width="{fx(640)-fx(-640):.0f}" height="46" fill="url(#soil)" opacity="0.8"/>')
line(fx(-640),BY,fx(640),BY,INK,1.6)
rect(fx(-505),fy(1090),fx(505)-fx(-505),fy(760)-fy(1090),"url(#cell)",INK,1.6)
txt(fx(0),fy(925)+4,"panel 1010 x 510",9.5,INK,"middle","600")
rect(fx(-150),fy(700),fx(150)-fx(-150),fy(500)-fy(700),"#ffffff",INK,1.6)
txt(fx(0),fy(600)+4,"box 300 x 200",9,INK,"middle")
rect(fx(-30),fy(500),fx(30)-fx(-30),BY-fy(500),"#ffffff",INK,1.4)
dimv(fx(-580),BY,fy(1090),"1090")
txt(fx(560),fy(1090)+4,"nothing above this",9.5,MID,"start")

# ===================== VIEW C =====================
CXo,CYo=700,420; sc=0.60
txt(700,404,"C   Inside the enclosure, lid off  (290 x 190 usable)",12.5,INK,"start","600")
rect(CXo,CYo,290*sc,190*sc,"#ffffff",INK,1.8)
rect(CXo+7,CYo+9,181*sc,167*sc,"none",INK,1.4)
txt(CXo+7+181*sc/2,CYo+9+167*sc-14,"LiFePO4 18 Ah",9.5,INK,"middle","600")
txt(CXo+7+181*sc/2,CYo+9+167*sc-2,"181 x 167 x 77, flat",8.5,MID,"middle")
rx0=CXo+7+181*sc+9
ys=CYo+9
for (w_,h_,lab) in [(88,58,"Pi 4"),(70,25,"RS485"),(90,30,"4G stick"),(65,26,"Witty Pi + buck")]:
    rect(rx0,ys,w_*sc,h_*sc,"none",INK,1.3); txt(rx0+3,ys+h_*sc/2+3.5,lab,8.8,INK)
    ys+=h_*sc+7
rect(CXo+22,CYo+22,113*sc,100*sc,"none",BLUE,1.3,"5 4")
line(CXo+22+113*sc,CYo+22,CXo+300,CYo+6,BLUE,1)
txt(CXo+303,CYo+9,"MPPT, stacked on the battery",8.8,BLUE)
for i,lab in enumerate(["panel","probes","vent"]):
    gx=CXo+34+i*60; circ(gx,CYo+190*sc,5,"#ffffff",ORANGE,1.6); txt(gx,CYo+190*sc+17,lab,8.3,ORANGE,"middle")
txt(CXo,CYo+190*sc+36,"3 x M20 gland on the underside, one vented. Mic port in the wall.",9.6,MID)
txt(CXo,CYo+190*sc+51,"Nothing enters from above.",9.6,MID)
txt(CXo,CYo+190*sc+72,"Volume used is 45%, but the battery must lie flat and takes",9.6,INK,"start","600")
txt(CXo,CYo+190*sc+86,"55% of the floor: 43 mm headroom above it. Measure before drilling.",9.6,INK,"start","600")

# ===================== VIEW D - probe trench =====================
DX,DY=700,966
txt(700,700,"What the in-box design costs",12.5,INK,"start","600")
for k,t in enumerate(["Power: survivable. December is the tight month and also the bare-field",
 "month, so the panel is unshaded exactly when it matters. A summer canopy",
 "cuts it to roughly 80 Wh/day against a 50 Wh load, which is why the panel",
 "is 100 Wp and not 50.",
 "Sound: a capsule at 500 mm behind a membrane hears a smaller circle than",
 "one on a mast, and crop rustle sits closer to it. That is the real price of",
 "this design. It buys a 10 cm I2S run instead of an impossible 1500 mm one,",
 "one cable and one gland fewer, and nothing at all sticking up.",
 "4G: the stick radiates through the plastic wall for a few dB of loss. The",
 "steel mounting plate is what would ruin it, so it does not go in the box.",
 "Wind: the panel is a 0.5 m2 sail. At 25 m/s it pushes about 170 N sideways, and",
 "raising the box from 300 to 500 mm lifts the overturning moment from roughly",
 "120 to 155 Nm. That is why the post is driven 800 rather than 600."]):
    txt(700,718+k*15,t,9.8,MID if k>3 else INK)
txt(700,950,"D   Probe trench, section",12.5,INK,"start","600")
A(f'<rect x="{DX}" y="{DY}" width="380" height="110" fill="url(#soil)" opacity="0.8"/>')
line(DX,DY,DX+380,DY,INK,1.6)
line(DX+40,DY,DX+40,DY+31,ORANGE,1.6); line(DX+40,DY+31,DX+300,DY+31,ORANGE,1.6)
txt(DX+165,DY+27,"cable, 120 deep slit",9,ORANGE,"middle")
for (xx,dep,lab) in [(DX+300,26,"probe 1  -100"),(DX+340,78,"probe 2  -300")]:
    line(xx,DY+31,xx,DY+dep,INK,2.4); circ(xx,DY+dep,3.4,INK)
    txt(xx+7,DY+dep+4,lab,9,INK)
line(DX+300,DY+31,DX+340,DY+31,ORANGE,1.6)
txt(DX,DY+120,"Probes 3 m from the post so the post's shadow and drip line do not bias the readings.",9.6,MID)

line(40,1175,1300,1175,LIGHT,1)
txt(40,1195,"Theft: matt green throughout, no reflective labels, no branding, cable lock through post and enclosure lugs. Machinery: a box this low is invisible to a sprayer too, so",10,MID)
txt(40,1211,"log the position on the farmer's own GPS and site it on a headland or beside a tramline rather than mid-crop.",10,MID)
A('</svg>')
open('/home/sven/uploads/life-node-low-mount.svg','w').write("\n".join(o))
print("ok")
