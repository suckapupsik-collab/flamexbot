// Shared Telegram Business status helpers. Admin reads go through the protected RPC only.
export const RIGHT_LABELS = {
  can_reply:'Отвечать на сообщения', can_read_messages:'Читать сообщения', can_delete_sent_messages:'Удалять отправленные',
  can_delete_all_messages:'Удалять все сообщения', can_edit_name:'Менять имя', can_edit_bio:'Менять описание',
  can_edit_profile_photo:'Менять фото', can_edit_username:'Менять username', can_change_gift_settings:'Настройки подарков',
  can_view_gifts_and_stars:'Видеть подарки и Stars', can_convert_gifts_to_stars:'Конвертировать подарки',
  can_transfer_and_upgrade_gifts:'Передавать подарки', can_transfer_stars:'Переводить Stars', can_manage_stories:'Управлять историями',
};
export function grantedRights(rights={}) {
  return Object.entries(rights||{}).filter(([,v])=>v===true).map(([k])=>k);
}
export function rightsChips(rights={}) {
  const granted=grantedRights(rights);
  return granted.length?granted.map(k=>'<span class="right-chip">'+(RIGHT_LABELS[k]||k.replace(/^can_/,'').replace(/_/g,' '))+'</span>').join(''):'<span class="right-chip is-empty">Права не выданы</span>';
}
export async function loadBusinessStatuses(supabase,users=[]) {
  const ids=users.map(u=>u.id).filter(Boolean);
  if(!ids.length)return new Map();
  const {data,error}=await supabase.rpc('admin_get_flamexbot_business_status',{p_user_ids:ids});
  if(error)throw error;
  return new Map((Array.isArray(data)?data:[]).map(row=>[row.profile_id,row]));
}
export async function checkLiveBusiness(supabase,profileId) {
  try {
    const {data,error}=await supabase.functions.invoke('flamexbot-business-status',{body:profileId?{profile_id:profileId}:{}});
    if(error||data?.error)throw new Error(data?.error||error?.message||'Проверка не выполнена');
    return {ok:true,live:true,connected:data.connected===true,rights:data.rights||{},reason:data.reason||null,connected_at:data.connected_at||null};
  } catch(e) {
    if(profileId) {
      const {data:cached,error:cacheError}=await supabase.from('flamexbot_business_connections')
        .select('is_enabled,rights,connected_at,updated_at').eq('profile_id',profileId).maybeSingle();
      if(!cacheError&&cached)return {ok:false,live:false,cached:true,connected:cached.is_enabled===true,rights:cached.rights||{},connected_at:cached.connected_at||null,updated_at:cached.updated_at||null,error:e?.message||'Telegram временно недоступен'};
    }
    return {ok:false,live:false,cached:false,connected:false,rights:{},error:e?.message||'Проверка не выполнена'};
  }
}
