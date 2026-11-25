"""Fetch single hours from Cornell's Sapsucker Woods soundscapes without the 28 GB zip: python fetch.py DIR FILE...

    uv run --with remotezip python fetch.py data SSW_008_20170225_120012Z.flac SSW_127_20170506_110007Z.flac \
        SSW_128_20170506_120007Z.flac SSW_144_20170513_090009Z.flac

Kahl, Charif and Klinck (2022), Zenodo 7079380, CC BY 4.0. The annotations are a separate file on the same record.
"""
import sys
import urllib.request
from remotezip import RemoteZip

RECORD = "https://zenodo.org/records/7079380/files/"
out, want = sys.argv[1], set(sys.argv[2:])
urllib.request.urlretrieve(RECORD + "annotations.csv?download=1", f"{out}/annotations.csv")
with RemoteZip(RECORD + "soundscape_data.zip?download=1") as z:
    for n in z.namelist():
        if n.split("/")[-1] in want:
            z.extract(n, out)
            print("fetched", n)
