import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")??"";
const ANON=Deno.env.get("SUPABASE_ANON_KEY")??"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return out({error:"Method not allowed"},405);
 const authorization=req.headers.get("Authorization")??"";
 const token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
 if(!token||!URL||!ANON||!SERVICE)return out({error:"Unauthorized"},401);
 try{
  const caller=createClient(URL,ANON,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await caller.auth.getUser(token);
  if(authError||!auth.user)return out({error:"Unauthorized"},401);
  const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:profile,error:profileError}=await admin.from("profiles").select("id,telegram_id,username,display_name").eq("id",auth.user.id).maybeSingle();
  if(profileError)throw profileError;
  if(!profile?.telegram_id)return out({error:"Сначала привяжи Telegram в профиле, чтобы техподдержка могла ответить тебе."},409);
  const body=await req.json().catch(()=>({}));
  const action=String(body?.action??"messages");
  const {data:chat,error:chatError}=await admin.from("flamexbot_support_chats")
   .select("id,telegram_chat_id,status,unread_count,last_message_at")
   .eq("telegram_chat_id",String(profile.telegram_id)).maybeSingle();
  if(chatError)throw chatError;
  if(action==="messages"){
   if(!chat)return out({chat:null,messages:[]});
   const {data:messages,error}=await admin.from("flamexbot_support_messages")
    .select("id,telegram_message_id,direction,content,message_type,created_at")
    .eq("support_chat_id",chat.id).order("created_at",{ascending:true}).limit(300);
   if(error)throw error;
   await admin.from("flamexbot_support_chats").update({unread_count:0}).eq("id",chat.id);
   return out({chat,messages:messages??[]});
  }
  if(action==="send"){
   const content=String(body?.content??"").trim();
   if(!content||content.length>4000)return out({error:"Сообщение должно содержать от 1 до 4000 символов."},400);
   const now=new Date().toISOString();
   const {data:ticket,error:ticketError}=await admin.from("flamexbot_support_chats").upsert({
    telegram_chat_id:String(profile.telegram_id),telegram_user_id:String(profile.telegram_id),
    username:profile.username??null,first_name:profile.display_name??null,
    last_message_preview:content.slice(0,240),last_message_at:now,status:"open",closed_at:null,updated_at:now
   },{onConflict:"telegram_chat_id"}).select("id,unread_count").single();
   if(ticketError)throw ticketError;
   const localMessageId=Number(Date.now()%2000000000)+1;
   const {error:messageError}=await admin.from("flamexbot_support_messages").insert({
    support_chat_id:ticket.id,telegram_message_id:localMessageId,direction:"incoming",
    content,message_type:"text",created_at:now
   });
   if(messageError)throw messageError;
   await admin.from("flamexbot_support_chats").update({unread_count:Number(ticket.unread_count??0)+1}).eq("id",ticket.id);
   const {data:admins,error:adminsError}=await admin.from("profile_badges").select("user_id").in("badge_code",["founder","administrator"]);
   if(adminsError)throw adminsError;
   const recipients=[...new Set(["74a352c0-5a26-46a8-9b88-e71d0c3a9879",...(admins??[]).map((x:any)=>x.user_id)])];
   if(recipients.length){
    const {error:noticeError}=await admin.from("notifications").insert(recipients.map(user_id=>({
     user_id,type:"support_message",title:"Новое сообщение в техподдержку",
     body:(profile.username?"@"+profile.username:profile.display_name||"Пользователь")+": "+content.slice(0,180),
     data:{support_chat_id:ticket.id}
    })));
    if(noticeError)throw noticeError;
   }
   return out({ok:true,chat_id:ticket.id});
  }
  return out({error:"Unknown action"},400);
 }catch(error){
  console.error("flamexbot-user-support:",error?.message??error);
  return out({error:"Не удалось обработать обращение."},500);
 }
});
