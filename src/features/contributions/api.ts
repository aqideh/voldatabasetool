import { supabase } from '../../lib/supabase';
import type { ContributionAuditRow, ContributionFilters, ContributionReviewRow, ContributionStatus } from '../../lib/types';

function safe(value:string){return value.trim().replace(/[,%()]/g,' ');}

export async function fetchContributionReviews(filters:ContributionFilters){
  const from=filters.page*filters.pageSize,to=from+filters.pageSize-1;
  let query=supabase.from('maklom_contribution_review_queue').select('*',{count:'exact'});
  const search=safe(filters.search);
  if(search){
    const p=`%${search}%`;
    query=query.or(`volunteer_name.ilike.${p},volunteer_code.ilike.${p},volunteer_email.ilike.${p},event_title.ilike.${p}`);
  }
  if(filters.status!=='all')query=query.eq('status',filters.status);
  const{data,error,count}=await query.order('occurred_at',{ascending:false}).range(from,to);
  if(error)throw error;
  return{rows:(data||[]) as ContributionReviewRow[],count:count||0};
}

export async function fetchContributionAudit(contributionId:string){
  const{data,error}=await supabase.from('volunteer_contribution_audit').select('*').eq('contribution_id',contributionId).order('changed_at',{ascending:false});
  if(error)throw error;return(data||[]) as ContributionAuditRow[];
}

export async function reviewContribution(row:ContributionReviewRow,input:{status:ContributionStatus;approvedMinutes:number|null;note:string|null}){
  const patch:{status:ContributionStatus;approved_minutes:number|null;approval_note:string|null}={
    status:input.status,
    approved_minutes:input.status==='approved'?input.approvedMinutes:null,
    approval_note:input.note,
  };
  const{data,error}=await supabase.from('volunteer_contributions').update(patch).eq('id',row.id).select('id').maybeSingle();
  if(error)throw error;if(!data)throw new Error('Contribution could not be updated.');
}
