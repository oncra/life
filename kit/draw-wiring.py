W,H=1340,980
INK="#111111"; MID="#555555"; LIGHT="#9a9a94"; PAPER="#fcfcfb"
RED="#c8322a"; BLUE="#2a78d6"; ORANGE="#eb6834"; GREEN="#1baf7a"
o=[];A=o.append
def esc(t): return t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def txt(x,y,t,s=11,f=INK,a="start",w="400",halo=True):
    h=f' stroke="{PAPER}" stroke-width="3" paint-order="stroke"' if halo else ""
    A(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{s}" fill="{f}" text-anchor="{a}" font-weight="{w}"{h}>{esc(t)}</text>')
def line(x1,y1,x2,y2,c=INK,w=1.4,d=None):
    A(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{c}" stroke-width="{w}"{f" stroke-dasharray=\'{d}\'" if d else ""} stroke-linecap="round"/>')
def pl(pts,c=INK,w=2,d=None):
    A(f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)}" fill="none" stroke="{c}" stroke-width="{w}"{f" stroke-dasharray=\'{d}\'" if d else ""} stroke-linejoin="round" stroke-linecap="round"/>')
def rect(x,y,w,h,f="none",st=INK,sw=1.4,d=None,rx=0):
    A(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{f}" stroke="{st}" stroke-width="{sw}" rx="{rx}"{f" stroke-dasharray=\'{d}\'" if d else ""}/>')
def circ(x,y,r,f=INK,st="none",sw=1):
    A(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{f}" stroke="{st}" stroke-width="{sw}"/>')
def tag(x,y,n,c=INK):
    circ(x,y,9,PAPER,c,1.4); txt(x,y+3.5,n,9,c,"middle","700",False)

A(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">')
A(f'<rect width="{W}" height="{H}" fill="{PAPER}"/>')
txt(40,34,"Life node v1 - enclosure wiring",17,INK,"start","600")
txt(40,54,"Everything inside the 300 x 200 x 130 box, lid off, seen from the front. Microphone and 4G antenna are internal; the Witty Pi 4 carries the DC/DC. Cable numbers match the schedule.",11.5,MID)
line(40,66,1300,66,LIGHT,1); line(718,90,718,890,LIGHT,1)

sc=1.55; X0,Y0=92,150
bx=lambda v: X0+v*sc; by=lambda v: Y0+v*sc
txt(40,116,"A   Interior layout and cable routing",12.5,INK,"start","600")
rect(X0-6,Y0-6,290*sc+12,190*sc+12,"none",INK,2.2)
rect(X0,Y0,290*sc,190*sc,"#ffffff",LIGHT,1)
txt(bx(145),Y0-14,"290 x 190 usable floor",9.5,MID,"middle")
rect(bx(4),by(4),181*sc,167*sc,"none",INK,1.6)
txt(bx(94),by(150),"LiFePO4 12.8 V 18 Ah",10,INK,"middle","600")
txt(bx(94),by(162),"181 x 167 x 77, lying flat",8.6,MID,"middle")
rect(bx(26),by(28),113*sc,100*sc,"none",BLUE,1.5,"6 4")
txt(bx(82),by(70),"MPPT 75/10",10,BLUE,"middle","600")
txt(bx(82),by(84),"on a shelf above the battery",8.4,BLUE,"middle")
def comp(x,y,w,h,lab,sub=None,col=INK,dash=None):
    rect(bx(x),by(y),w*sc,h*sc,"#ffffff",col,1.5,dash)
    txt(bx(x+w/2),by(y+h/2)+(0 if sub is None else -4),lab,9.4,col,"middle","600")
    if sub: txt(bx(x+w/2),by(y+h/2)+9,sub,8.2,MID,"middle")
comp(190,4,56,88,"Pi 4","+ Witty Pi 4 on top")
comp(252,4,34,24,"USB 5 V","breakout",GREEN)
comp(252,52,34,30,"INMP441",None,GREEN)
comp(190,98,70,25,"USB-RS485")
comp(190,129,90,30,"4G stick","internal antenna")
circ(bx(269),by(96),6,"#ffffff",GREEN,1.8); txt(bx(269),by(110),"mic port",8.4,GREEN,"middle")
line(bx(269),by(82),bx(269),by(90),GREEN,1.6)
gl=[(40,"W1 panel"),(100,"W9 probe 1"),(148,"W9 probe 2"),(200,"vent")]
for gx,lab in gl:
    circ(bx(gx),by(190)+6,7,"#ffffff",ORANGE,1.8); txt(bx(gx),by(190)+30,lab,8.6,ORANGE,"middle")
txt(X0,by(190)+52,"4 glands, all on the UNDERSIDE. The mic port is a 5 mm hole in the wall, not a gland.",9.6,MID)
pl([(bx(40),by(190)+6),(bx(40),by(178)),(bx(18),by(178)),(bx(18),by(140)),(bx(40),by(120)),(bx(40),by(78))],RED,2.4); tag(bx(30),by(160),"1",RED)
pl([(bx(139),by(78)),(bx(168),by(78)),(bx(168),by(24)),(bx(150),by(14))],RED,2.4); tag(bx(168),by(50),"2",RED)
circ(bx(150),by(14),4,RED); txt(bx(150)+9,by(14)+3,"fuse 15 A",8.6,RED)
pl([(bx(139),by(96)),(bx(184),by(96)),(bx(184),by(60)),(bx(190),by(60))],ORANGE,2.2); tag(bx(178),by(80),"3",ORANGE)
pl([(bx(252),by(66)),(bx(240),by(66)),(bx(240),by(60)),(bx(232),by(52))],GREEN,2.2); tag(bx(243),by(74),"13",GREEN)
pl([(bx(100),by(190)+6),(bx(100),by(180)),(bx(186),by(180)),(bx(186),by(110)),(bx(190),by(110))],BLUE,2.4); tag(bx(140),by(180),"9",BLUE)
pl([(bx(286),by(16)),(bx(288),by(16)),(bx(288),by(186)),(bx(154),by(186))],GREEN,1.6); tag(bx(288),by(120),"7",GREEN)
pl([(bx(235),by(144)),(bx(246),by(144)),(bx(246),by(96))],MID,1.6); txt(bx(250),by(122),"USB",8,MID)
lx,ly=92,by(190)+78
for i,(c,lab) in enumerate([(RED,"12 V power, fused"),(ORANGE,"switched 12 V (MPPT load output)"),(GREEN,"5 V / I2S audio"),(BLUE,"RS485 data")]):
    line(lx,ly+i*17-4,lx+22,ly+i*17-4,c,2.6); txt(lx+28,ly+i*17,lab,9.6,MID)
SY=by(190)+182
txt(92,SY-16,"Cable schedule",12.5,INK,"start","600")
rows=[("W1","panel to MPPT","the panel's own 80 cm leads, MC4 cut off, ferruled","0.3 m"),
 ("W2","MPPT to battery","2 x 2.5 mm2 + inline 15 A blade fuse + ring terminals","0.4 m"),
 ("W3","MPPT LOAD to Witty Pi 4 VIN","Witty Pi's supplied 30 cm XH2.54 lead, ferrules at the MPPT","0.3 m"),
 ("W6","Witty Pi 4 to Pi","GPIO header, no cable; the Witty Pi powers the Pi through it","-"),
 ("W7","probe power","5 V and GND from the USB-A breakout to both probe leads","0.2 m"),
 ("W9","box to probes","own 2 m leads: A/B to the RS485 adapter, +/- to the breakout","2 m"),
 ("W13","microphone to Pi","6-core Dupont on I2S, via a stacking header under the Witty Pi","0.1 m")]
line(92,SY-6,660,SY-6,LIGHT,1)
for i,(n,a_,b_,l_) in enumerate(rows):
    y=SY+13+i*17.5
    if i%2==0: A(f'<rect x="92" y="{y-12:.1f}" width="568" height="17.5" fill="{LIGHT}" opacity="0.07"/>')
    txt(96,y,n,9.4,INK,"start","700"); txt(133,y,a_,9.4,INK); txt(300,y,b_,9.4,MID); txt(655,y,l_,9.4,INK,"end")
yend=SY+13+len(rows)*17.5
line(92,yend-2,660,yend-2,LIGHT,1)
txt(96,yend+16,"Gone since the first drawing: the buck and its cable, the terminal block, the MOSFET probe switch, the lavalier and sound",9.4,MID)
txt(96,yend+31,"card, the antenna pigtail and whip, the 20 m cable and its junction box. Seven runs where there were thirteen.",9.4,MID)

SX=760
txt(SX-18,116,"B   One-line schematic",12.5,INK,"start","600")
def blk(x,y,w,h,lab,sub=None,col=INK):
    rect(x,y,w,h,"#ffffff",col,1.6,None,3)
    txt(x+w/2,y+(h/2)+(0 if sub is None else -4),lab,9.8,col,"middle","600")
    if sub: txt(x+w/2,y+h/2+10,sub,8.3,MID,"middle")
blk(SX,150,110,42,"100 Wp panel","Voc 23 V")
blk(SX,232,110,42,"MPPT 75/10",None,BLUE)
blk(SX+170,232,110,42,"battery 18 Ah","230 Wh")
blk(SX,320,110,42,"LOAD output","low-voltage cut",ORANGE)
blk(SX,410,110,48,"Witty Pi 4","DC/DC + RTC + schedule")
blk(SX,510,110,42,"Raspberry Pi 4")
blk(SX+170,510,110,38,"USB-RS485",None,BLUE)
blk(SX+340,510,110,38,"4G stick","internal antenna")
blk(SX+170,410,110,42,"2 x soil probe","5 V + RS485",BLUE)
blk(SX+340,410,110,38,"INMP441 mic","I2S, in the box",GREEN)
def arr(x1,y1,x2,y2,c=INK,n=None):
    pl([(x1,y1),(x2,y2)],c,2)
    if n: tag((x1+x2)/2 if y1==y2 else x1,(y1+y2)/2,n,c)
arr(SX+55,192,SX+55,232,RED,"1")
pl([(SX+110,253),(SX+170,253)],RED,2); tag(SX+140,253,"2",RED)
arr(SX+55,274,SX+55,320,RED)
arr(SX+55,362,SX+55,410,ORANGE,"3")
arr(SX+55,458,SX+55,510,GREEN,"6")
pl([(SX+170,529),(SX+110,529)],BLUE,2)
pl([(SX+225,510),(SX+225,452)],BLUE,2); tag(SX+225,481,"9",BLUE)
pl([(SX+110,520),(SX+140,520),(SX+140,431),(SX+170,431)],GREEN,2); tag(SX+140,475,"7",GREEN)
pl([(SX+340,529),(SX+280,529)],MID,2)
pl([(SX+340,429),(SX+300,429),(SX+300,520)],GREEN,2); tag(SX+320,429,"13",GREEN)
notes=[("The Witty Pi 4 takes 12 V from the LOAD output on its own 6 to 30 V input and",MID),
 ("feeds the Pi through the GPIO header at up to 3 A. No buck, no USB power lead.",MID),
 ("The probes take 5 V from a USB breakout, so they go on and off with the Pi.",MID),
 ("Never wire them to the load output: it is not switched, and they would draw",MID),
 ("0.5 W around the clock, more than the whole winter budget.",MID),
 ("",MID),
 ("Witty Pi 4 uses GPIO 2, 3, 4 and 17 and watches GPIO 14. The I2S pins 18-21",INK),
 ("are free; the mic needs a stacking header under the Witty Pi for room only.",INK),
 ("",MID),
 ("Both probes leave the factory on Modbus address 1. Re-address one to 2",INK),
 ("(register 07D0) on the bench, or they collide and neither reads.",INK),
 ("",MID),
 ("SEN0600 exposes moisture (0000H) and temperature (0001H) only, so it uses",MID),
 ("the sen0600 profile, which reads two registers rather than three.",MID),
 ("",MID),
 ("Probe wire colours are not published. Meter them before splicing: the family",MID),
 ("convention is brown +V, black GND, yellow A, blue B.",MID)]
for k,(t,c) in enumerate(notes):
    if t: txt(SX-18,612+k*15,t,9.8,c,"start","600" if c==INK else "400")
line(40,905,1300,905,LIGHT,1)
txt(40,926,"Leave the galvanised steel mounting plate out of the box. A 4G antenna radiates through the plastic wall for a few dB of loss, but a steel plate beside it detunes the antenna and",10,MID)
txt(40,942,"puts nulls in the pattern. Mount the boards on a cut sheet of 3 mm plastic instead. Paint the box: ABS is not UV-stable, and the paint is its protection before it is camouflage.",10,MID)
txt(40,962,"Nothing here is verified on hardware yet. Meter every colour and check every connector against the part in your hand before you cut anything.",10,INK,"start","600")
A('</svg>')
open('/home/sven/uploads/life-node-wiring.svg','w').write("\n".join(o))
print("wiring ok")
