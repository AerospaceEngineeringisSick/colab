"""Download the CC0 samples used by the soundtrack from freesound.org, verify each is CC0 on its page,
convert to 44.1 kHz WAV in samples/, and write samples/CREDITS.md.   python3 tools/fetch_samples.py"""
import os, re, html, subprocess, urllib.request
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'samples'); os.makedirs(OUT, exist_ok=True)
import imageio_ffmpeg; FF = imageio_ffmpeg.get_ffmpeg_exe()

SAMPLES = {  # name: freesound id
    'kick_trappy': 240893, 'kick_trap1': 501553, 'kick_808deep': 208447,
    'snare_trap': 278983, 'snare_trap1': 399747, 'snare_phonk': 791993,
    'clap_fat': 239906, 'clap_snare': 355065,
    'hat_clean': 674296, 'hat_hiphop': 448223, 'hat_modular': 363203, 'hat_serum': 652026,
    'ohat_909': 165028, 'ohat_2': 509985,
    'crash_909': 743638, 'crash_1': 538194, 'revcrash': 110218, 'revcymbal': 23127,
    'impact_cine': 177242, 'impact_low': 408141, 'impact_deep2': 754421, 'impact_deep3': 754422,
    'subdrop': 212768, 'subdrop_synth': 475005,
    'whoosh_whip': 486234, 'whoosh_quick': 683101, 'swoosh': 169867, 'whoosh_mid': 449996,
    'riser_short': 685256, 'riser_hit': 510293, 'riser_long': 789101,
    'braam_dist': 697057, 'braam_unfa': 647712, 'braam_hit': 431316,
    'glitch_2': 424374, 'glitch_sfx': 673773, 'glitch_1': 441966, 'glitch_allpass': 662734,
    'vinyl': 493122, 'error_1': 572936, 'error_2': 558121, 'error_mm': 699923,
    'cash': 209578, 'stamp': 362622, 'msg_in': 760369, 'msg_out': 760370, 'popup': 242502,
    'typing': 685984,
    'kick_house': 137722, 'kick_bigroom': 265328, 'snare_edm': 270276, 'snare_wide': 319613, 'boom': 157245, 'notif': 740423, 'shutter': 271010, 'cowbell_1shot': 75339, 'cowbell_phonk': 468208, 'cowbell_phonk2': 830213,
}
UA = {'User-Agent': 'Mozilla/5.0'}
rows = []
for name, sid in SAMPLES.items():
    wav = os.path.join(OUT, name + '.wav')
    page = urllib.request.urlopen(urllib.request.Request(f'https://freesound.org/s/{sid}/', headers=UA), timeout=30)
    url, s = page.geturl(), page.read().decode()
    lic_ok = 'creativecommons.org/publicdomain/zero' in s
    title = html.unescape(re.search(r'<meta property="og:title" content="([^"]*)"', s).group(1)).rsplit(' by ', 1)[0]
    user = re.search(r'/people/([^/]+)/sounds/', url).group(1)
    mp3 = re.search(r'https://cdn\.freesound\.org/previews/[^"]+-hq\.mp3', s)
    mp3 = mp3.group(0) if mp3 else re.search(r'https://cdn\.freesound\.org/previews/[^"]+-lq\.mp3', s).group(0).replace('-lq', '-hq')
    assert lic_ok, f'{name} ({sid}) is not CC0!'
    if not os.path.exists(wav):
        tmp = wav + '.mp3'
        open(tmp, 'wb').write(urllib.request.urlopen(urllib.request.Request(mp3, headers=UA), timeout=60).read())
        subprocess.run([FF, '-y', '-loglevel', 'error', '-i', tmp, '-ar', '44100', '-ac', '2', wav], check=True)
        os.remove(tmp)
    rows.append(f'| `{name}` | [{title}]({url}) | {user} | CC0 1.0 |')
    print('ok', name, '-', title)
open(os.path.join(OUT, 'CREDITS.md'), 'w').write(
    '# Samples\n\nAll samples are from [freesound.org](https://freesound.org) and released under **CC0 1.0 (public domain)**, checked on each sound\'s page by `tools/fetch_samples.py`. No attribution is required; credit is given anyway.\n\n'
    '| File | Sound | By | License |\n|---|---|---|---|\n' + '\n'.join(rows) + '\n')
