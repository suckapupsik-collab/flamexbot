import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")??"", ANON=Deno.env.get("SUPABASE_ANON_KEY")??"", SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"", BOT=Deno.env.get("TELEGRAM_BOT_TOKEN")??"";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers});
 if(req.method!=="POST") return reply({error:"Method not allowed"},405);
 try {
  const token=(req.headers.get("Authorization")??"").replace(/^Bearer /,"");
  if(!token) return reply({error:"Unauthorized"},401);
  const user=createClient(URL,ANON,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await user.auth.getUser(token);
  if(authError||auth.user?.id!=="74a352c0-5a26-46a8-9b88-e71d0c3a9879") return reply({error:"Founder access required"},403);
  const body=await req.json();
  const chargeId=typeof body.charge_id==="string"?body.charge_id.trim():"";
  if(!chargeId) return reply({error:"charge_id is required"},400);
  const reason=String(body.reason??"Возврат Premium из панели Основателя").slice(0,500);
  const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:payment,error:paymentError}=await admin.from("flamexbot_star_payments").select("*").eq("telegram_payment_charge_id",chargeId).maybeSingle();
  if(paymentError) throw paymentError;
  if(!payment||payment.plan!=="premium"||payment.currency!=="XTR") return reply({error:"Платёж Premium не найден"},404);
  const {data:existing,error:existingError}=await admin.from("flamexbot_refunded_star_payments").select("*").eq("telegram_payment_charge_id",chargeId).maybeSingle();
  if(existingError) throw existingError;
  if(existing?.status==="refunded") return reply({ok:true,refund_status:"refunded",already_refunded:true});
  if(existing) {
   if(existing.user_id!==payment.user_id||existing.telegram_user_id!==payment.telegram_user_id||existing.invoice_payload!==payment.invoice_payload||existing.payment_kind!=="premium"||existing.total_amount!==payment.total_amount)
    return reply({error:"Refund record does not match original payment"},409);
  } else {
   const {data:eligibility,error:checkError}=await user.rpc("admin_preview_flamexbot_premium_refund",{p_telegram_payment_charge_id:chargeId});
   if(checkError) throw checkError;
   if(!eligibility?.eligible) return reply({error:eligibility?.reason??"Возврат не разрешён"},409);
   const {error:prepareError}=await admin.rpc("prepare_flamexbot_star_refund",{
    p_telegram_payment_charge_id:chargeId,p_user_id:payment.user_id,p_telegram_user_id:payment.telegram_user_id,
    p_invoice_payload:payment.invoice_payload,p_payment_kind:"premium",p_currency:payment.currency,
    p_total_amount:payment.total_amount,p_provider_payment_charge_id:payment.provider_payment_charge_id,p_reason:reason
   });
   if(prepareError) throw prepareError;
  }
  if(!BOT) return reply({error:"Telegram bot token is not configured; refund remains pending"},503);
  const tg=await fetch("https://api.telegram.org/bot"+BOT+"/refundStarPayment",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({user_id:Number(payment.telegram_user_id),telegram_payment_charge_id:chargeId}),
   signal:AbortSignal.timeout(12000)
  });
  const result=await tg.json();
  if(!tg.ok||!result.ok) {
   const msg=String(result.description??"Telegram refund failed");
   if(!/ALREADY_REFUNDED|already refunded/i.test(msg)) return reply({error:msg,refund_status:"pending"},502);
  }
  const {data:completed,error:completeError}=await admin.rpc("complete_flamexbot_star_refund",{p_telegram_payment_charge_id:chargeId});
  if(completeError||completed!==true) {
   console.error("Premium refund completed at Telegram but DB completion failed",chargeId,completeError?.message);
   return reply({error:"Telegram refund processed; database completion needs retry",refund_status:"pending"},502);
  }
  try {
   await fetch("https://api.telegram.org/bot"+BOT+"/sendMessage",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:Number(payment.telegram_user_id),text:"↩️ Возврат "+Number(payment.total_amount)+" ⭐ за Premium выполнен. Оплаченные дни этой покупки отменены. Если Premium был активен до этой покупки, оставшийся срок сохранён."}),
    signal:AbortSignal.timeout(8000)
   });
  } catch(notificationError) { console.error("Premium refund notification failed",notificationError?.message??notificationError); }
  return reply({ok:true,refund_status:"refunded",charge_id:chargeId});
 } catch(error) {
  console.error("admin-premium-refund:",error?.message??error);
  return reply({error:error?.message??"Refund failed"},500);
 }
});