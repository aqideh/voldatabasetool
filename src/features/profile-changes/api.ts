import { supabase } from '../../lib/supabase';
import type { ProfileChangeFilters, ProfileChangeReviewRow } from '../../lib/types';

function safe(value:string){return value.trim().replace(/[,%()]/g,' ');}

export async function fetchProfileChangeReviews(filters:ProfileChangeFilters){
  const from=filters.page*filters.pageSize,to=from+filters.pageSize-1;
  let query=supabase.from('maklom_profile_change_review_queue').select('*',{count:'exact'});
  const search=safe(filters.search);
  if(search){
    const p=`%${search}%`;
    query=query.or(`volunteer_name.ilike.${p},volunteer_code.ilike.${p},volunteer_email.ilike.${p},old_value.ilike.${p},new_value.ilike.${p}`);
  }
  if(filters.status!=='all')query=query.eq('status',filters.status);
  const{data,error,count}=await query.order('source_changed_at',{ascending:false}).range(from,to);
  if(error)throw error;
  return{rows:(data||[]) as ProfileChangeReviewRow[],count:count||0};
}

export async function reviewProfileChange(row:ProfileChangeReviewRow,input:{decision:'approved'|'rejected';note:string|null}){
  const{data,error}=await supabase.rpc('review_volunteer_profile_change',{
    p_change_id:row.id,
    p_decision:input.decision,
    p_review_note:input.note,
  });
  if(error)throw error;
  if(!data)throw new Error('Profile change could not be reviewed.');
}
