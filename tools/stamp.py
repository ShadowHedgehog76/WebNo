#!/usr/bin/env python3
"""Estampille les fichiers d'une version, pour que le navigateur ne serve
jamais un mélange d'ancien et de neuf après une mise en ligne.

    python3 tools/stamp.py            → version = date + heure
    python3 tools/stamp.py 42         → version imposée

Réécrit la version dans index.html (feuille de style et module d'entrée)
et dans chaque import relatif des fichiers js/.
"""
import re, sys, time, pathlib

racine = pathlib.Path(__file__).resolve().parent.parent
version = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%Y%m%d%H%M')

def estampille(url: str) -> str:
    base = url.split('?')[0]
    return f'{base}?v={version}'

# ── index.html ──
html = (racine / 'index.html').read_text()
html = re.sub(r'href="(css/style\.css)(\?v=[^"]*)?"', lambda m: f'href="{estampille(m.group(1))}"', html)
html = re.sub(r'src="(js/app\.js)(\?v=[^"]*)?"', lambda m: f'src="{estampille(m.group(1))}"', html)
(racine / 'index.html').write_text(html)

# ── imports relatifs des modules ──
touches = 0
for f in sorted((racine / 'js').glob('*.js')):
    src = f.read_text()
    neuf = re.sub(
        r"from '(\./[\w.-]+\.js)(\?v=[^']*)?'",
        lambda m: f"from '{estampille(m.group(1))}'",
        src)
    if neuf != src:
        f.write_text(neuf)
        touches += 1

print(f'version {version} — index.html + {touches} module(s)')
