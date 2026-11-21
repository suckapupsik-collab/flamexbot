const haptic = kind => { try { const h=window.Telegram?.WebApp?.HapticFeedback; if(kind==="error"||kind==="success")h?.notificationOccurred(kind);else h?.impactOccurred("light"); } catch {} };
const lockKey=id=>"flamexbot.pin.lock."+id;
const readLock=id=>{try{return JSON.parse(localStorage.getItem(lockKey(id))||"{}");}catch{return {};}};
function pinDialog(title,subtitle,initial="") {
  return new Promise(resolve=>{
    const overlay=document.createElement("div");overlay.className="pin-dialog-backdrop";
    overlay.innerHTML='<section class="pin-dialog"><div class="pin-emblem">✦</div><div class="eyebrow">FLAMEXBOT SECURITY</div><h3>'+title+'</h3><p class="muted">'+subtitle+'</p><div class="pin-dots">'+Array.from({length:4},()=>"<i></i>").join("")+'</div><div class="pin-pad">'+["1","2","3","4","5","6","7","8","9","","0","⌫"].map(k=>k?'<button type="button" data-k="'+k+'">'+k+'</button>':'<span></span>').join("")+'</div><div class="pin-dialog-actions"><button type="button" data-ok>Подтвердить</button><button type="button" data-cancel>Отмена</button></div><p class="pin-error" role="alert"></p></section>';
    document.body.appendChild(overlay);const root=overlay.querySelector(".pin-dialog"),dots=root.querySelector(".pin-dots"),error=root.querySelector(".pin-error");let value=initial;
    const paint=()=>{dots.innerHTML=Array.from({length:Math.max(4,value.length)},(_,i)=>'<i class="'+(i<value.length?"on":"")+'"></i>').join("");};
    const close=v=>{document.removeEventListener("keydown",key);overlay.remove();resolve(v);};
    const submit=()=>{if(value.length<4){error.textContent="Введи минимум 4 цифры";return;}close(value);};
    const press=k=>{if(k==="⌫")value=value.slice(0,-1);else if(value.length<8)value+=k;paint();haptic();if(value.length===8)submit();};
    const key=e=>{if(/^\d$/.test(e.key))press(e.key);else if(e.key==="Backspace")press("⌫");else if(e.key==="Enter")submit();else if(e.key==="Escape")close(null);};
    root.querySelectorAll("[data-k]").forEach(b=>b.addEventListener("click",()=>press(b.dataset.k)));
    root.querySelector("[data-ok]").addEventListener("click",submit);root.querySelector("[data-cancel]").addEventListener("click",()=>close(null));overlay.addEventListener("click",e=>{if(e.target===overlay)close(null);});
    document.addEventListener("keydown",key);paint();
  });
}
export async function promptPinVerify(id,checkPin,title="Введи текущий PIN") {
  const lock=readLock(id),left=(lock.until||0)-Date.now();if(left>0){alert("Повтори через "+Math.ceil(left/1000)+" сек.");return false;}
  const pin=await pinDialog(title,"Подтверди текущий PIN-код");if(pin===null)return false;
  if(await checkPin(id,pin)){localStorage.removeItem(lockKey(id));haptic("success");return true;}
  const fails=(lock.fails||0)+1,until=fails%5===0?Date.now()+Math.min(300,15*2**(fails/5-1))*1000:0;
  localStorage.setItem(lockKey(id),JSON.stringify({fails,until}));haptic("error");return false;
}
export async function promptPinSetup() {
  const first=await pinDialog("Придумай PIN-код","От 4 до 8 цифр");if(first===null)return null;
  const second=await pinDialog("Повтори PIN-код","Введи тот же PIN ещё раз");if(second===null)return null;
  if(first!==second){haptic("error");return {mismatch:true};}return {pin:first};
}
export function gatePin({app,session,pinKey,unlockKey,checkPin,onSignOut}) {
  const id=session?.user?.id;if(!id||!localStorage.getItem(pinKey(id))||sessionStorage.getItem(unlockKey(id))==="1")return Promise.resolve(true);
  return new Promise(resolve=>{
    const host=document.createElement("div");host.id="pin-gate-host";app.replaceChildren(host);
    const show=async()=>{const lock=readLock(id),left=(lock.until||0)-Date.now();if(left>0){host.innerHTML='<main class="pin-screen"><section class="pin-dialog"><h3>Защита временно заблокирована</h3><p>Повтори через '+Math.ceil(left/1000)+' сек.</p><button id="pin-retry">Проверить снова</button><button id="pin-exit">Выйти</button></section></main>';host.querySelector("#pin-retry").onclick=show;host.querySelector("#pin-exit").onclick=async()=>{await onSignOut();resolve(false);};return;}
      const pin=await pinDialog("Введи PIN-код","Разблокируй FLAMEXBOT");if(pin===null){await onSignOut();resolve(false);return;}
      if(await checkPin(id,pin)){localStorage.removeItem(lockKey(id));sessionStorage.setItem(unlockKey(id),"1");resolve(true);return;}
      const fails=(lock.fails||0)+1,until=fails%5===0?Date.now()+Math.min(300,15*2**(fails/5-1))*1000:0;localStorage.setItem(lockKey(id),JSON.stringify({fails,until}));haptic("error");await show();
    };show();
  });
}
