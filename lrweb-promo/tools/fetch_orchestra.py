"""Download the orchestral samples the score uses (all CC0 1.0 / public domain) into samples/orch/.

Sources (both by Versilian Studios, released under CC0):
  VSCO 2 Community Edition   https://github.com/sgossner/VSCO-2-CE   strings, brass
  Versilian Community Sample Library (VCSL)   https://github.com/sgossner/VCSL   Steinway B grand, timpani, drums, cymbals

The file list is tools/orchestra_files.txt (repo<TAB>path). Files already downloaded are skipped.
    python tools/fetch_orchestra.py
"""
import os, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'samples', 'orch')
REPOS = {'VSCO-2-CE': 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/',
         'VCSL': 'https://raw.githubusercontent.com/sgossner/VCSL/master/'}


def local(repo, path):
    return os.path.join(OUT, repo, *path.split('/'))


def get(item):
    repo, path = item
    dst = local(repo, path)
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        return 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    url = REPOS[repo] + urllib.parse.quote(path)
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(url, timeout=60).read()
            if data[:4] != b'RIFF':
                raise ValueError('not a wav (git-lfs pointer?)')
            open(dst + '.part', 'wb').write(data); os.replace(dst + '.part', dst)
            return len(data)
        except Exception as e:  # retry with backoff
            if attempt == 3:
                print('FAILED', path, e, file=sys.stderr); return -1
            import time; time.sleep(2 ** attempt)


if __name__ == '__main__':
    items = [tuple(l.split('\t')) for l in open(os.path.join(HERE, 'tools', 'orchestra_files.txt')).read().splitlines() if l.strip()]
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(get, items))
    print(f'{sum(r > 0 for r in res)} downloaded, {sum(r == 0 for r in res)} already there, {sum(r < 0 for r in res)} failed '
          f'({sum(r for r in res if r > 0) / 1e6:.0f} MB) -> {OUT}')
    sys.exit(1 if any(r < 0 for r in res) else 0)
