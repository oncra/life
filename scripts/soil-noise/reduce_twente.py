# Streams each Twente station's calibrated readings and quality flags from DANS (doi 10.17026/dans-znj-wyg5,
# CC BY 4.0) and keeps 10, 20 and 40 cm moisture, 10 cm temperature and the per-probe quality and setup flags: one
# gzipped CSV per station in DATA/red, timestamps in UTC. Nothing raw is stored.
#   python3 scripts/soil-noise/reduce_twente.py [DATA]     (DATA defaults to ~/scratch/twente)
import gzip, io, json, os, sys, urllib.request, datetime as dt
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/scratch/twente')
os.makedirs(os.path.join(DATA, 'red'), exist_ok=True)
API = 'https://phys-techsciences.datastations.nl/api'
d = json.load(urllib.request.urlopen(f'{API}/datasets/:persistentId/?persistentId=doi:10.17026/dans-znj-wyg5', timeout=120))['data']['latestVersion']
files = {}
for f in d['files']:
    df = f['dataFile']; name = df['filename']
    if name.startswith('ITCSM_') and (name.endswith('_cd.csv') or name.endswith('_fg.csv')):
        files[name] = df['id']
stations = sorted({n[:-7] for n in files})
def lines(fid):
    r = urllib.request.urlopen(f'{API}/access/datafile/{fid}', timeout=600)
    for raw in io.TextIOWrapper(r, encoding='latin-1'):
        yield raw.rstrip('\n')
for st in stations:
    out = os.path.join(DATA, 'red', f'{st}.csv.gz')
    try:
        open(out); print(st, 'exists', flush=True); continue
    except FileNotFoundError: pass
    # header: find depths
    cd = lines(files[st + '_cd.csv']); fg = lines(files[st + '_fg.csv'])
    hdr = None
    for l in cd:
        if l.startswith('Date time'): hdr = [h.strip() for h in l.split(',')]; next(cd); break
    depths = [h.split()[0] for h in hdr[1::2]]  # e.g. ['5','10','20','40','80'] per SM column
    # flags file: skip until data rows (start with dd-mm-yyyy)
    def fgrows():
        for l in fg:
            if len(l) > 16 and l[2] == '-' and l[5] == '-':
                yield l
    fgi = fgrows()
    want = {'10': None, '20': None, '40': None}
    for i, dep in enumerate(depths):
        if dep in want: want[dep] = i
    n = 0
    with gzip.open(out + '.tmp', 'wt') as w:
        w.write('ts,sm10,sm20,sm40,st10,q10,q20,q40,ms10,ms20,ms40\n')
        for l in cd:
            if not l or l[2] != '-': continue
            p = [x.strip() for x in l.split(',')]
            fl = next(fgi, None)
            key = lambda x: x[6:10] + x[3:5] + x[0:2] + x[11:16]
            while fl is not None and key(fl) < key(p[0]):
                fl = next(fgi, None)
            if fl is not None and key(fl) != key(p[0]):
                fl = None  # flags out of step for this row: treat as unknown
            t = dt.datetime.strptime(p[0], '%d-%m-%Y %H:%M') - dt.timedelta(hours=1)  # CET -> UTC
            vals = []
            for dep in ('10', '20', '40'):
                i = want[dep]
                v = p[1 + 2 * i] if i is not None else '-99.999'
                vals.append('' if v.startswith('-99') else v)
            i10 = want['10']; st10 = p[2 + 2 * i10] if i10 is not None else '-99.9'
            st10 = '' if st10.startswith('-99') else st10
            q = ['9', '9', '9']; ms = ['9', '9', '9']
            if fl:
                fp = [x.strip() for x in fl.split(',')]
                smf = next((x for x in fp if x.startswith('SM')), 'SM99999')[2:]
                msf = next((x for x in fp if x.startswith('MS')), 'MS99999')[2:]
                for k, dep in enumerate(('10', '20', '40')):
                    i = want[dep]
                    if i is not None and i < len(smf): q[k] = smf[i]; ms[k] = msf[i] if i < len(msf) else '9'
            if not any(vals): continue
            w.write(t.strftime('%Y-%m-%dT%H:%M') + ',' + ','.join(vals) + ',' + st10 + ',' + ','.join(q) + ',' + ','.join(ms) + '\n')
            n += 1
    os.rename(out + '.tmp', out)
    print(st, 'depths', depths, 'rows', n, flush=True)
