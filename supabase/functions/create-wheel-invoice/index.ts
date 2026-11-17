import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const SUPABASE_ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")??"";
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const BOT_TOKEN=Deno.env.get("TELEGRAM_BOT_TOKEN")??"";
const PRICE_STARS=5;
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const response=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
async function telegram(method:string,body:Record<string,unknown>){
 const r=await fetch("https://api.telegram.org/bot"+BOT_TOKEN+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description??("Telegram API "+method+" failed"));return d.result;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 const auth=req.headers.get("Authorization")??"";const token=auth.startsWith("Bearer ")?auth.slice(7):"";
 if(!token)return response({error:"Unauthorized"},401);
 if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!SERVICE_ROLE_KEY||!BOT_TOKEN)return response({error:"Payment service unavailable"},503);
 try{
  const userClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:"Bearer "+token}},auth:{autoRefreshToken:false,persistSession:false}});
  const {data:authData,error:authError}=await userClient.auth.getUser(token);
  if(authError||!authData.user)return response({error:"Unauthorized"},401);
  const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
  const body=await req.json().catch(()=>({}));
  const {data:profile,error:profileError}=await admin.from("profiles").select("id,telegram_id,is_banned,ban_reason,wheel_free_spins").eq("id",authData.user.id).maybeSingle();
  if(profileError)throw profileError;
  if(!profile?.telegram_id)return response({error:"Сначала привяжи Telegram в профиле."},400);
  if(profile.is_banned)return response({error:profile.ban_reason||"Аккаунт заблокирован."},403);
  if(body?.action==="free_spin"){
    const {data:prize,error:prizeError}=await admin.rpc("redeem_flamexbot_free_wheel_spin",{p_user_id:authData.user.id});
    if(prizeError)throw prizeError;
    let notificationClaimToken:string|null=null;
    if(prize?.notification_id){
      const claimToken=crypto.randomUUID();
      const {data:claimed,error:claimError}=await admin.rpc("claim_flamexbot_telegram_notification_by_id",{
        p_notification_id:prize.notification_id,
        p_user_id:authData.user.id,
        p_claim_token:claimToken
      });
      if(claimError)console.warn("Could not claim free wheel notification:",claimError.message);
      else if(claimed?.some((item:any)=>item.notification_id===prize.notification_id))notificationClaimToken=claimToken;
    }
    if(notificationClaimToken){
      let sent=false;
      try{
        let buttonEmojiId:string|null=null;
        try{
          const id="5877318502947229960";
          const stickers=await telegram("getCustomEmojiStickers",{custom_emoji_ids:[id]});
          buttonEmojiId=Array.isArray(stickers)&&stickers.some((item:any)=>String(item?.custom_emoji_id)===id)?id:null;
        }catch(error){
          console.warn("Wheel button emoji unavailable; using fallback:",(error as any)?.message??error);
        }
        const button:any={text:"✦ Открыть FLAMEXBOT",web_app:{url:"https://flamexbot.pages.dev"}};
        if(buttonEmojiId)button.icon_custom_emoji_id=buttonEmojiId;
        const notificationText="🎡 Колесо фортуны FLAMEXBOT\\n\\nТвоя награда: "+String(prize?.prize_label??"Награда начислена")+".\\nОткрой Mini App, чтобы посмотреть баланс и срок тарифа.";
        try{
          await telegram("sendMessage",{
            chat_id:Number(profile.telegram_id),text:notificationText,
            reply_markup:{inline_keyboard:[[button]]},disable_web_page_preview:true
          });
        }catch(buttonError){
          if(!buttonEmojiId)throw buttonError;
          delete button.icon_custom_emoji_id;
          await telegram("sendMessage",{
            chat_id:Number(profile.telegram_id),text:notificationText,
            reply_markup:{inline_keyboard:[[button]]},disable_web_page_preview:true
          });
        }
        sent=true;
      }catch(notificationError){
        const reason=String((notificationError as any)?.message??notificationError);
        const outcomeUnknown=notificationError instanceof TypeError||/timeout|timed out|network|connection reset|aborted/i.test(reason);
        if(!outcomeUnknown){
          const {error:releaseError}=await admin.rpc("release_flamexbot_telegram_notification_claims",{p_claim_token:notificationClaimToken});
          if(releaseError)console.warn("Could not release free wheel notification claim:",releaseError.message);
        }
        console.warn("Wheel reward DM was not delivered:",reason);
      }
      if(sent){
        const {data:marked,error:markError}=await admin.rpc("mark_flamexbot_telegram_notification_delivered",{
          p_notification_id:prize.notification_id,
          p_claim_token:notificationClaimToken
        });
        if(markError||marked!==true)console.warn("Could not confirm free wheel notice delivery:",markError?.message??"claim token no longer owns notification");
      }
    }
    return response({ok:true,free_spin:true,prize});
  }
  const orderId=crypto.randomUUID();
  const payload="flamexbot_wheel:"+profile.id+":"+orderId;
  const {error:insertError}=await admin.from("flamexbot_wheel_orders").insert({id:orderId,user_id:profile.id,telegram_user_id:profile.telegram_id,invoice_payload:payload,price_stars:PRICE_STARS,status:"pending"});
  if(insertError)throw insertError;
  let invoiceLink:string;
  try{
    invoiceLink=await telegram("createInvoiceLink",{title:"Колесо фортуны FLAMEXBOT",description:"Одна прокрутка колеса фортуны. Награда начисляется автоматически.",payload,currency:"XTR",prices:[{label:"Одна прокрутка",amount:PRICE_STARS}]});
  }catch(invoiceError){
    const {error:cleanupError}=await admin.from("flamexbot_wheel_orders")
      .delete().eq("id",orderId).eq("status","pending");
    if(cleanupError)console.warn("Could not clean up wheel order after invoice creation failure:",cleanupError.message);
    throw invoiceError;
  }
  return response({ok:true,invoice_link:invoiceLink,order_id:orderId,price_stars:PRICE_STARS});
 }catch(error){console.error("create-wheel-invoice:",error?.message??error);return response({error:error?.message??"Не удалось создать счёт"},500);}
});