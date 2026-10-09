// Renders each scene (scenes/sN.html) to a segment mp4, then joins with dissolves, grades, adds score.
// usage: node render.mjs [--scenes s1,s2] [--fps 30] [--preview] [--join] [--still s3:4.2]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k,d)=>{const i=process.argv.indexOf('--'+k); return i<0?d:(process.argv[i+1]?.startsWith('--')||process.argv[i+1]==null?true:process.argv[i+1]);};
const timeline = JSON.parse(fs.readFileSync(path.join(here,'timeline.json'),'utf8'));
const FPS = +arg('fps', 30), PREVIEW = !!arg('preview', false), TAIL = timeline.tail;
const only = arg('scenes', null)?.split(',');
const exe = ['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p=>fs.existsSync(p) && fs.statSync(p).isFile());
const launch = ()=>chromium.launch({ executablePath: exe, args:['--no-sandbox','--disable-gpu','--force-color-profile=srgb','--font-render-hinting=none'] });
fs.mkdirSync(path.join(here,'out'),{recursive:true});

async function openScene(browser, id){
  const page = await browser.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor: PREVIEW?0.5:1 });
  page.on('pageerror', e=>console.error(`[${id}] PAGE ERROR`, e.message));
  page.on('console', m=>{ if(m.type()==='error') console.error(`[${id}] console.error`, m.text()); });
  await page.goto('file://'+path.join(here,'scenes',id+'.html'));
  await page.waitForFunction('window.__ready===true',null,{timeout:30000});
  return page;
}
async function still(spec){ const [id,t]=spec.split(':'); const b=await launch(); const p=await openScene(b,id);
  await p.evaluate(t=>window.render(t),+t); const f=path.join(here,'out',`still-${id}-${t}.png`); await p.screenshot({path:f}); await b.close(); console.log(f); }

async function renderScene(sc){
  const dur = sc.slot + (sc.last?0:TAIL), n = Math.round(dur*FPS);
  const out = path.join(here,'out',`${sc.id}${PREVIEW?'.prev':''}.mp4`);
  const b = await launch(); const page = await openScene(b, sc.id);
  const sceneDur = await page.evaluate(()=>window.DURATION);
  if (sceneDur < dur-0.01) console.warn(`[${sc.id}] DURATION ${sceneDur}s < needed ${dur}s (will hold last frame)`);
  const ff = spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(FPS),'-c:v','mjpeg','-i','-',
    '-vf', PREVIEW?'scale=960:540':'null','-c:v','libx264','-preset',PREVIEW?'veryfast':'medium','-crf',PREVIEW?'26':'16','-pix_fmt','yuv420p',out],{stdio:['pipe','inherit','inherit']});
  const t0=Date.now();
  for(let i=0;i<n;i++){
    await page.evaluate(t=>window.render(t), Math.min(i/FPS, sceneDur));
    const buf = await page.screenshot({type:'jpeg',quality:PREVIEW?80:95});
    if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
    if(i%60===0) process.stdout.write(`\r[${sc.id}] ${i}/${n}  ${((Date.now()-t0)/1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r=>ff.on('close',r)); await b.close(); console.log(`\r[${sc.id}] done ${n} frames -> ${out}`);
}

function join(){
  const sc = timeline.scenes, sfx = PREVIEW?'.prev':'';
  const inputs = sc.flatMap(s=>['-i',path.join(here,'out',s.id+sfx+'.mp4')]);
  let f='', last='[0:v]', acc=0;
  for(let i=1;i<sc.length;i++){ acc += sc[i-1].slot; // offset = start of scene i in output
    const tr = sc[i].transition || 'fade';
    f += `${last}[${i}:v]xfade=transition=${tr}:duration=${TAIL}:offset=${acc}[v${i}];`; last=`[v${i}]`; }
  const total = sc.reduce((a,s)=>a+s.slot,0);
  // cinematic finish: gentle bloom-ish grade, vignette, 2.39:1 letterbox bars, light film grain, end fade
  const grade = `${last}eq=contrast=1.06:saturation=1.08,vignette=PI/5,noise=alls=7:allf=t,` +
    `drawbox=x=0:y=0:w=iw:h=ih*0.0625:color=black:t=fill,drawbox=x=0:y=ih*0.9375:w=iw:h=ih*0.0625:color=black:t=fill,` +
    `fade=t=in:st=0:d=0.5,fade=t=out:st=${total-1.2}:d=1.2[vout]`;
  const wav = path.join(here,'out','trailer.wav'); const hasA = fs.existsSync(wav);
  const args = ['-y','-loglevel','error',...inputs,...(hasA?['-i',wav]:[]),'-filter_complex',f+grade,'-map','[vout]',
    ...(hasA?['-map',`${sc.length}:a`,'-c:a','aac','-b:a','256k']:[]),
    '-c:v','libx264','-preset',PREVIEW?'veryfast':'slow','-crf',PREVIEW?'24':'15','-pix_fmt','yuv420p','-movflags','+faststart','-t',String(total),
    path.join(here,'out',PREVIEW?'LRWeb-trailer.preview.mp4':'LRWeb-trailer.mp4')];
  execFileSync('ffmpeg',args,{stdio:'inherit'}); console.log('joined', total+'s', hasA?'with audio':'(no audio yet)');
}

if (arg('still',false)) await still(arg('still'));
else {
  if (!arg('join-only',false)) {
    const list = timeline.scenes.filter(s=>!only||only.includes(s.id));
    const par = +arg('par', 3); const q=[...list];
    await Promise.all(Array.from({length:par},async()=>{ while(q.length) await renderScene(q.shift()); }));
  }
  if (!only || arg('join',false)) join();
}
