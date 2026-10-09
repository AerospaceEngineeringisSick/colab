/* LRWeb trailer kit: tiny deterministic helpers shared by every scene.
   A scene defines window.DURATION (seconds) and window.render(t). Everything must be a pure
   function of t: no Date, no Math.random (use K.rng), no CSS transitions/animations, no rAF. */
(function(){
const K = window.K = {};
K.W = 1920; K.H = 1080;
K.clamp = (x,a=0,b=1)=>Math.min(b,Math.max(a,x));
K.lerp = (a,b,p)=>a+(b-a)*p;
K.map = (x,a,b,c,d)=>c+(d-c)*K.clamp((x-a)/(b-a));          // clamped remap
K.prog = (t,t0,t1)=>K.clamp((t-t0)/(t1-t0));                // 0..1 progress of t within [t0,t1]
K.ease = {
  in:    p=>p*p*p,
  out:   p=>1-Math.pow(1-p,3),
  out5:  p=>1-Math.pow(1-p,5),                              // very soft landing (cinematic)
  io:    p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2,
  back:  p=>{const c=1.70158,c3=c+1;return 1+c3*Math.pow(p-1,3)+c*Math.pow(p-1,2)},
  elastic:p=>p===0?0:p===1?1:Math.pow(2,-10*p)*Math.sin((p*10-.75)*(2*Math.PI)/3)+1,
  expo:  p=>p===1?1:1-Math.pow(2,-10*p),
};
K.rng = function(seed){ let s = seed>>>0 || 1;               // mulberry32, deterministic
  return ()=>{ s|=0; s=s+0x6D2B79F5|0; let t=Math.imul(s^s>>>15,1|s); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
K.noise1 = (x,seed=1)=>{ const f=Math.floor(x), p=x-f, h=n=>{const r=K.rng(n*7919+seed*104729);return r()}; const u=p*p*(3-2*p); return K.lerp(h(f),h(f+1),u)*2-1; };
K.$ = (s,root=document)=>root.querySelector(s);
K.$$ = (s,root=document)=>[...root.querySelectorAll(s)];
K.el = (tag,cls,parent,html)=>{const e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; (parent||document.getElementById('stage')).appendChild(e); return e;};
K.set = (e,o)=>{ // set opacity / transform pieces quickly: {x,y,s,r,o,blur}
  const t=`translate(${o.x||0}px,${o.y||0}px) rotate(${o.r||0}deg) scale(${o.sx??o.s??1},${o.sy??o.s??1})`;
  e.style.transform=t; if(o.o!=null)e.style.opacity=o.o; if(o.blur!=null)e.style.filter=`blur(${o.blur}px)`; };
K.typed = (str,p)=>str.slice(0,Math.round(str.length*K.clamp(p)));
K.fmt = (n,d=0)=>n.toLocaleString('en-GB',{minimumFractionDigits:d,maximumFractionDigits:d});
/* splits text into per-letter spans (class .ch) so scenes can stagger them; returns the spans */
K.splitChars = (el)=>{ const txt=el.textContent; el.textContent=''; return [...txt].map(c=>{const s=document.createElement('span'); s.className='ch'; s.style.display='inline-block'; s.style.whiteSpace='pre'; s.textContent=c; el.appendChild(s); return s;}); };
/* a drifting starfield / dust drawn on a canvas, deterministic in t. Call K.stars(ctx,t,{n,seed,speed,alpha}) */
K.stars = (ctx,t,{n=160,seed=3,speed=6,alpha=1,color='245,248,250'}={})=>{
  const r=K.rng(seed);
  for(let i=0;i<n;i++){ const x0=r()*K.W, y0=r()*K.H, z=.3+r()*.7, tw=r()*6.28;
    const x=((x0 - t*speed*z)%K.W+K.W)%K.W; const a=alpha*(.25+.75*z)*(.6+.4*Math.sin(t*(1+z*2)+tw));
    ctx.fillStyle=`rgba(${color},${a.toFixed(3)})`; ctx.beginPath(); ctx.arc(x,y0,.6+z*1.3,0,6.283); ctx.fill(); } };
/* aurora ribbons on a 2D canvas (cheap, no WebGL needed). intensity 0..1 */
K.aurora = (ctx,t,{intensity=1,y0=.45,seed=5,hueShift=0}={})=>{
  const W=K.W,H=K.H; ctx.save(); ctx.globalCompositeOperation='lighter';
  const cols=[['61,184,141',.55],['11,134,234',.45],['63,77,230',.5],['139,149,247',.25]];
  cols.forEach((c,i)=>{
    for(let k=0;k<2;k++){
      ctx.beginPath(); const baseY=H*(y0+(i-1.5)*.07+k*.03);
      const pts=[]; for(let x=-40;x<=W+40;x+=40){ const u=x/W*3.2+i*1.7+k*.9;
        const y=baseY+Math.sin(u+t*.35*(1+i*.2))*70+Math.sin(u*2.3-t*.5)*30+K.noise1(u*1.5+t*.3,seed+i)*60; pts.push([x,y]); }
      ctx.moveTo(pts[0][0],pts[0][1]); pts.forEach(p=>ctx.lineTo(p[0],p[1]));
      const g=ctx.createLinearGradient(0,baseY-380,0,baseY+160); g.addColorStop(0,`rgba(${c[0]},0)`); g.addColorStop(.6,`rgba(${c[0]},${(c[1]*.35*intensity).toFixed(3)})`); g.addColorStop(1,`rgba(${c[0]},0)`);
      ctx.lineTo(W+40,baseY-380); for(let j=pts.length-1;j>=0;j--) ctx.lineTo(pts[j][0],pts[j][1]-380-Math.sin(pts[j][0]*.01+t*.4+i)*60);
      ctx.closePath(); ctx.fillStyle=g; ctx.fill(); }});
  ctx.restore(); };
/* wait for fonts + images, then let the renderer drive. ?t=3.2 renders one frame in a normal browser. */
K.ready = (initFn)=>{
  const imgs=[...document.images].map(i=>i.decode?i.decode().catch(()=>{}):0);
  Promise.all([document.fonts.ready,...imgs]).then(async()=>{
    for(const f of ['400 40px "Bricolage Grotesque"','700 40px "Bricolage Grotesque"','800 40px "Bricolage Grotesque"','500 40px "Instrument Sans"','600 40px "Instrument Sans"','500 40px "IBM Plex Mono"']) { try{await document.fonts.load(f)}catch(e){} }
    if(initFn) await initFn();
    window.__ready = true;
    const q=new URLSearchParams(location.search);
    if(q.has('t')) window.render(parseFloat(q.get('t')));
    if(q.has('scrub')){ const s=document.createElement('input'); s.type='range'; s.min=0; s.max=window.DURATION; s.step=.01; s.value=0; s.style.cssText='position:fixed;left:20px;bottom:10px;width:1800px;z-index:99;'; s.oninput=()=>window.render(parseFloat(s.value)); document.body.appendChild(s); window.render(0); }
  });
};
})();
