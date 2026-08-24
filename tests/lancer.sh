#!/bin/sh
# Lance les deux suites : le moteur en ligne de commande, le plateau dans un
# vrai navigateur — la 3D exige un contexte WebGL qu'aucun simulateur ne donne.
set -e
cd "$(dirname "$0")/.."

echo "▸ moteur"
node tests/moteur.mjs

echo
echo "▸ plateau (navigateur)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=8791
python3 -m http.server $PORT >/dev/null 2>&1 &
SERVEUR=$!
trap 'kill $SERVEUR 2>/dev/null' EXIT
sleep 1
for SUITE in plateau cadrage; do
echo "  · $SUITE"
SORTIE=$("$CHROME" --headless=new --use-gl=angle --use-angle=swiftshader \
  --enable-unsafe-swiftshader --virtual-time-budget=30000 --window-size=1000,1000 \
  --dump-dom "http://localhost:$PORT/tests/$SUITE.html" 2>/dev/null)
echo "$SORTIE" | python3 -c "
import sys, re, html
d = sys.stdin.read()
m = re.search(r'<div id=\"out\">(.*)</div>\s*<script', d, re.S)
t = m.group(1) if m else '(aucune sortie)'
t = t.replace('<h3>', '\n').replace('</h3>', '')
t = re.sub(r'<div class=\"(ok|ko)\">', '\n  ', t).replace('</div>', '')
print(html.unescape(t).strip())
sys.exit(1 if 'ECHEC' in d or '✗' in t else 0)
"
done
