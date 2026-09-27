import { supabase } from '../../lib/supabase';
import type { ProfileInboxFilters, ProfileInboxRow, ProfileInboxStatus } from '../../lib/types';

function safe(value:string){return value.trim().replace(/[,%()]/g,' ');}

export async function fetchProfileInbox(filters:ProfileInboxFilters){
  const from=filters.page*filters.pageSize,to=from+filters.pageSize-1;
  let query=supabase.from('maklom_profile_inbox_review_queue').select('*',{count:'exact'});
  const search=safe(filters.search);
  if(search){
    const p=`%${search}%`;
    query=query.or(`volunteer_name.ilike.${p},volunteer_email.ilike.${p},event_title.ilike.${p},title.ilike.${p},reviewed_title.ilike.${p}`);
  }
  if(filters.status!=='all')query=query.eq('status',filters.status);
  if(filters.sourceKind!=='all')query=query.eq('source_kind',filters.sourceKind);
  const{data,error,count}=await query.order('created_at',{ascending:false}).range(from,to);
  if(error)throw error;
  return{rows:(data||[]) as ProfileInboxRow[],count:count||0};
}

export async function fetchVolunteerInboxHistory(volunteerId:string){
  const{data,error}=await supabase
    .from('maklom_profile_inbox_review_queue')
    .select('*')
    .eq('volunteer_id',volunteerId)
    .order('created_at',{ascending:false})
    .limit(100);
  if(error)throw error;
  return(data||[]) as ProfileInboxRow[];
}

export async function reviewProfileInbox(row:ProfileInboxRow,input:{status:Extract<ProfileInboxStatus,'accepted'|'dismissed'>;title:string;summary:string;note:string|null}){
  if(input.status==='accepted'&&!row.volunteer_id)throw new Error('Match this record to a volunteer before accepting it.');
  const{data:userData,error:userError}=await supabase.auth.getUser();
  if(userError)throw userError;
  const reviewedPayload={summary:input.summary.trim()};
  const{data,error}=await supabase
    .from('maklom_profile_inbox')
    .update({
      status:input.status,
      reviewed_title:input.title.trim()||row.title,
      reviewed_payload:reviewedPayload,
      review_note:input.note,
      reviewed_by:userData.user?.id||null,
      reviewed_at:new Date().toISOString(),
    })
    .eq('id',row.id)
    .select('id')
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Inbox record could not be updated.');
}
