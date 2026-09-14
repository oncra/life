m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
h100=[120,180,300,400,400,400,400,360,320,240,140,100]
canopy=lambda i: 0.20 if 3<=i<=8 else 1.0
s100=[h100[i]*canopy(i) for i in range(12)]
s50=[v*0.5 for v in s100]
winter=lambda i: i in (0,1,10,11)
load=[9.6 if winter(i) else 54.6 for i in range(12)]
W,H=880,520; L,R,T,B=64,138,62,116
pw,ph=W-L-R,H-T-B; ymax=420
X=lambda i: L+pw*i/11
Y=lambda v: T+ph*(1-v/ymax)
S1,S2,LOADC="#2a78d6","#eb6834","#111111"
INK,INK2,MUT="#111111","#52514e","#b9b8b2"
p=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">',
   f'<rect width="{W}" height="{H}" fill="#fcfcfb"/>',
   f'<text x="{L}" y="26" font-size="15" font-weight="600" fill="{INK}">Where the panel size is actually decided</text>',
   f'<text x="{L}" y="45" font-size="12" fill="{INK2}">Wh/day. Harvest shaded to 20% Apr-Sep for a crop canopy. Load steps down to one waking hour Nov-Feb.</text>']
for gv in range(0,401,100):
    y=Y(gv); p.append(f'<line x1="{L}" y1="{y:.1f}" x2="{L+pw}" y2="{y:.1f}" stroke="{MUT}" stroke-width="1" opacity="0.45"/>')
    p.append(f'<text x="{L-10}" y="{y+4:.1f}" font-size="11" fill="{INK2}" text-anchor="end">{gv}</text>')
for i,lab in enumerate(m):
    p.append(f'<text x="{X(i):.1f}" y="{T+ph+20}" font-size="11" fill="{INK2}" text-anchor="middle">{lab}</text>')
# the binding band: Apr-Sep
p.append(f'<rect x="{X(3)-14:.1f}" y="{T}" width="{X(8)-X(3)+28:.1f}" height="{ph}" fill="{S2}" opacity="0.08"/>')
p.append(f'<text x="{(X(3)+X(8))/2:.1f}" y="{T+15}" font-size="11" fill="{S2}" text-anchor="middle" font-weight="600">under a summer canopy: this is what sizes the panel</text>')
# stepped load
pts=[]
for i in range(12):
    pts.append((X(i)-(pw/22 if i>0 else 0),Y(load[i]))); pts.append((X(i)+pw/22,Y(load[i])))
p.append('<polyline points="'+" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)+f'" fill="none" stroke="{LOADC}" stroke-width="2.4" stroke-dasharray="6 5" stroke-linejoin="round"/>')
def path(v): return "M "+" L ".join(f"{X(i):.1f} {Y(x):.1f}" for i,x in enumerate(v))
p.append(f'<path d="{path(s100)}" fill="none" stroke="{S1}" stroke-width="2.2" stroke-linejoin="round"/>')
p.append(f'<path d="{path(s50)}" fill="none" stroke="{S2}" stroke-width="2.2" stroke-linejoin="round"/>')
for i in range(12):
    p.append(f'<circle cx="{X(i):.1f}" cy="{Y(s100[i]):.1f}" r="4" fill="{S1}" stroke="#fcfcfb" stroke-width="2"/>')
    p.append(f'<circle cx="{X(i):.1f}" cy="{Y(s50[i]):.1f}" r="4" fill="{S2}" stroke="#fcfcfb" stroke-width="2"/>')
p.append(f'<text x="{L+pw+9}" y="{Y(s100[-1])+4:.1f}" font-size="12" font-weight="600" fill="{S1}">100 Wp</text>')
p.append(f'<text x="{L+pw+9}" y="{Y(s50[-1])+16:.1f}" font-size="12" font-weight="600" fill="{S2}">50 Wp</text>')
p.append(f'<text x="{L+pw+9}" y="{Y(load[-1])-8:.1f}" font-size="12" font-weight="600" fill="{LOADC}">load</text>')
p.append(f'<g transform="translate({L},{H-74})" font-size="11.5">'
         f'<rect x="0" y="-9" width="11" height="3" rx="1.5" fill="{S1}"/><text x="18" y="-4" fill="{INK2}">100 Wp, shaded</text>'
         f'<rect x="122" y="-9" width="11" height="3" rx="1.5" fill="{S2}"/><text x="140" y="-4" fill="{INK2}">50 Wp, shaded</text>'
         f'<rect x="240" y="-9" width="11" height="3" rx="1.5" fill="{LOADC}"/><text x="258" y="-4" fill="{INK2}">node load, incl. a 4.6 Wh/day parasitic floor</text></g>')
for k,t in enumerate(["Winter is not the problem. With one waking hour from November to February the node eats",
 "9.6 Wh/day, and even a 50 Wp panel harvests 40 to 60 in those months.",
 "The 50 Wp line fails in summer instead, by 15 to 23 Wh/day, and no winter schedule fixes that.",
 "The panel is sized by the crop that shades it, not by December."]):
    p.append(f'<text x="{L}" y="{H-56+k*15}" font-size="11.5" fill="{INK}">{t}</text>')
p.append("</svg>")
open('/home/sven/uploads/life-node-energy-balance.svg','w').write("\n".join(p))
print("ok")
