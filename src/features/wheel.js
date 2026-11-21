const META = {
  free_spin: ["🎁","Прокрутка","#2fc4b2"], addon: ["🛡️","Защита","#43b97f"],
  premium_7d: ["⭐","7 дней","#ff9340"], premium_30d: ["⭐","30 дней","#9b6cf0"],
  premium_90d: ["👑","90 дней","#f2b93b"], premium_day: ["⭐","1 день","#ff9340"],
  coins_10: ["🪙","10","#5b7fd6"], coins_50: ["🪙","50","#4c9be0"],
  coins_100: ["💰","100","#d9694f"], coins_250: ["💎","250","#c25bd0"]
};
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const polar = (r,d) => { const a=(d-90)*Math.PI/180; return [r*Math.cos(a),r*Math.sin(a)]; };
export function buildSectors(rows) {
  return (Array.isArray(rows)?rows:[]).filter(r=>r && r.is_active!==false && Number(r.weight ?? 1)>0).slice(0,14).map((r,i)=>{
    const type=r.prize_type||r.type||r.prize_code||"", m=META[type]||["🎁",String(r.prize_label||"Приз").slice(0,9),["#ff9340","#5b7fd6","#43b97f","#9b6cf0"][i%4]];
    return {type,code:r.prize_code||"",label:r.prize_label||m[1],icon:m[0],short:m[1],color:m[2]};
  });
}
export function findSector(sectors,prize) {
  if(!prize)return -1;
  let i=sectors.findIndex(s=>s.type && s.type===prize.prize_type);
  if(i<0)i=sectors.findIndex(s=>s.code && s.code===prize.prize_code);
  if(i<0)i=sectors.findIndex(s=>s.label===prize.prize_label);
  return i;
}
export function createWheel(host,sectors) {
  if(!host)return {sectors,spinTo:()=>Promise.resolve(-1),startWaiting:()=>{},stopWaiting:()=>{}};
  if(!sectors.length){host.innerHTML='<p class="muted">Награды временно недоступны.</p>';return {sectors,spinTo:()=>Promise.resolve(-1),startWaiting:()=>{},stopWaiting:()=>{}};}
  const n=sectors.length, step=360/n;
  const paths=sectors.map((s,i)=>{
    const a=polar(98,i*step),b=polar(98,(i+1)*step),t=polar(67,(i+.5)*step),l=polar(46,(i+.5)*step),rot=(i+.5)*step;
    const d=n===1?'M0 0 L0 -98 A98 98 0 1 1 0 98 A98 98 0 1 1 0 -98 Z':'M0 0 L'+a[0].toFixed(2)+' '+a[1].toFixed(2)+' A98 98 0 0 1 '+b[0].toFixed(2)+' '+b[1].toFixed(2)+' Z';
    return '<g class="wsec" data-i="'+i+'"><path d="'+d+'" fill="'+s.color+'" stroke="rgba(255,255,255,.5)" stroke-width="1"/><text x="'+t[0].toFixed(2)+'" y="'+t[1].toFixed(2)+'" transform="rotate('+rot+' '+t[0].toFixed(2)+' '+t[1].toFixed(2)+')" text-anchor="middle" dominant-baseline="middle" font-size="16">'+s.icon+'</text><text x="'+l[0].toFixed(2)+'" y="'+l[1].toFixed(2)+'" transform="rotate('+rot+' '+l[0].toFixed(2)+' '+l[1].toFixed(2)+')" text-anchor="middle" dominant-baseline="middle" font-size="7" font-weight="800" fill="#fff">'+esc(s.short)+'</text></g>';
  }).join("");
  host.innerHTML='<div class="wheel3"><div class="wheel3-pointer"></div><svg viewBox="-112 -112 224 224" class="wheel3-svg"><circle r="109" fill="#171d2a" stroke="#f2b93b" stroke-width="2"/><g class="wrot">'+paths+'</g><circle r="20" fill="#10141d" stroke="#f2b93b" stroke-width="3"/></svg><div class="wheel3-hub">✦</div></div>';
  const root=host.querySelector(".wheel3"),rot=host.querySelector(".wrot"); let angle=0,wait=0;
  const apply=()=>{rot.style.transform="rotate("+angle+"deg)";rot.style.transformOrigin="0 0";};
  return {
    sectors,
    startWaiting(){if(wait)return;root.classList.add("is-waiting");let prev=performance.now();const loop=t=>{if(!wait)return;const dt=(t-prev)/1000;prev=t;angle+=Math.min(220,60+dt*100)*dt;apply();wait=requestAnimationFrame(loop);};wait=requestAnimationFrame(loop);},
    stopWaiting(){if(wait)cancelAnimationFrame(wait);wait=0;root.classList.remove("is-waiting");},
    spinTo(index){this.stopWaiting();if(!Number.isInteger(index)||index<0||index>=n)return Promise.resolve(-1);const jitter=(Math.random()-.5)*step*.5,target=(360-((index+.5)*step+jitter)%360)%360,cur=((angle%360)+360)%360,delta=((target-cur)+360)%360+360*5,from=angle;root.classList.add("is-spinning");return new Promise(resolve=>{const t0=performance.now(),frame=t=>{const p=Math.min(1,(t-t0)/4600),e=1-Math.pow(1-p,4);angle=from+delta*e;apply();if(p<1)requestAnimationFrame(frame);else{root.classList.remove("is-spinning");root.classList.add("is-landed");host.querySelector('.wsec[data-i="'+index+'"]')?.classList.add("win");setTimeout(()=>root.classList.remove("is-landed"),1400);resolve(index);}};host.querySelectorAll(".wsec.win").forEach(x=>x.classList.remove("win"));requestAnimationFrame(frame);});}
  };
}
export function confetti(origin) {
  if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return;
  const c=document.createElement("canvas");c.className="fx-confetti";c.width=innerWidth;c.height=innerHeight;document.body.appendChild(c);
  const ctx=c.getContext("2d"),r=origin?.getBoundingClientRect?.(),ox=r?r.left+r.width/2:c.width/2,oy=r?r.top+r.height/2:c.height/3,colors=["#ff9340","#f2b93b","#43b97f","#5b7fd6","#c25bd0","#fff"];
  const ps=Array.from({length:70},()=>({x:ox,y:oy,vx:(Math.random()-.5)*12,vy:-Math.random()*12-2,s:4+Math.random()*5,c:colors[Math.floor(Math.random()*colors.length)],a:Math.random()*6}));
  let f=0;const run=()=>{ctx.clearRect(0,0,c.width,c.height);ps.forEach(p=>{p.vy+=.32;p.x+=p.vx;p.y+=p.vy;p.a+=.1;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.c;ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*.6);ctx.restore();});if(++f<100)requestAnimationFrame(run);else c.remove();};run();
}
