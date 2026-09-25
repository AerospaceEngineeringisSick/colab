"""Search freesound.org for CC0-only sounds (license filter) and list candidates.
   python3 tools/fs_search.py "trap snare" "808 kick" ...
"""
import re, sys, html, urllib.parse, urllib.request, json

def search(q, pages=1):
    out = []
    for p in range(1, pages + 1):
        url = 'https://freesound.org/search/?' + urllib.parse.urlencode({'q': q, 'f': 'license:"Creative Commons 0"', 'page': p})
        s = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20).read().decode()
        for blk in s.split('class="bw-player"')[1:]:
            g = lambda k: (re.search(k + r'="([^"]*)"', blk) or [None, ''])[1]
            out.append(dict(id=g('data-sound-id'), user=g('data-username'), title=html.unescape(g('data-title')),
                            dur=float(g('data-duration') or 0), dl=int(g('data-num-downloads') or 0), mp3=g('data-mp3').replace('-lq.mp3', '-hq.mp3')))
    return out

if __name__ == '__main__':
    res = {}
    for q in sys.argv[1:]:
        r = sorted(search(q), key=lambda x: -x['dl'])
        res[q] = r
        print(f'== {q}')
        for x in r[:12]:
            print(f"  {x['id']:>7} {x['dur']:6.2f}s {x['dl']:>6}dl  {x['title'][:50]}  ({x['user']})")
    json.dump(res, open('/tmp/fs_last.json', 'w'))
