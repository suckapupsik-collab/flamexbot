import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")??"",ANON=Deno.env.get("SUPABASE_ANON_KEY")??"",SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",BOT=Deno.env.get("TELEGRAM_BOT_TOKEN")??"";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 try{
  const token=(req.headers.get("Authorization")??"").replace(/^Bearer /,"");
  if(!token)return reply({error:"Unauthorized"},401);
  const user=createClient(URL,ANON,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await user.auth.getUser(token);
  if(authError||auth.user?.id!=="74a352c0-5a26-46a8-9b88-e71d0c3a9879")return reply({error:"Founder access required"},403);
  const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  const {order_id,reason}=await req.json();
  if(typeof order_id!=="string")return reply({error:"Invalid order id"},400);
  const {data:order,error}=await admin.from("flamexbot_wheel_orders").select("*").eq("id",order_id).maybeSingle();
  if(error)throw error;
  if(!order||order.status!=="paid"||!order.telegram_payment_charge_id)return reply({error:"Заказ не найден или уже не оплаченный"},409);
  if(order.prize_type)return reply({error:"Возврат этой прокрутки заблокирован: награда уже начислена. Сначала нужна безопасная отмена самой награды."},409);
  const {data:profile,error:profileError}=await admin.from("profiles").select("is_banned").eq("id",order.user_id).maybeSingle();
  if(profileError)throw profileError;
  const {error:prepareError}=await admin.rpc("prepare_flamexbot_star_refund",{p_telegram_payment_charge_id:order.telegram_payment_charge_id,p_user_id:order.user_id,p_telegram_user_id:order.telegram_user_id,p_invoice_payload:order.invoice_payload,p_payment_kind:"wheel",p_currency:"XTR",p_total_amount:order.price_stars,p_provider_payment_charge_id:order.provider_payment_charge_id,p_reason:String(reason??"Возврат из панели Основателя").slice(0,500)});
  if(prepareError)throw prepareError;
  const tg=await fetch("https://api.telegram.org/bot"+BOT+"/refundStarPayment",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({user_id:Number(order.telegram_user_id),telegram_payment_charge_id:order.telegram_payment_charge_id}),signal:AbortSignal.timeout(12000)});
  const result=await tg.json();
  if(!tg.ok||!result.ok){const msg=String(result.description??"Telegram refund failed");if(!/ALREADY_REFUNDED|already refunded/i.test(msg))throw new Error(msg);}
  const {data:completed,error:completeError}=await admin.rpc("complete_flamexbot_star_refund",{p_telegram_payment_charge_id:order.telegram_payment_charge_id});
  if(completeError||completed!==true)throw completeError??new Error("Не удалось завершить запись возврата");
  return reply({ok:true,order_id,refund_status:"refunded"});
 }catch(error){console.error("admin-wheel-refund:",error?.message??error);return reply({error:error?.message??"Refund failed"},500);}
});