import { supabase } from '../../lib/supabase';

export interface WorkEventGroup {
  key:string;
  eventId:string|null;
  eventName:string;
  eventDate:string|null;
  count:number;
  unresolvedIdentities:number;
  reviewRows:number;
}

export interface WorkContributionGroup {
  eventTitle:string;
  count:number;
  needsReview:number;
  oldestOccurredAt:string|null;
}

export interface WorkSummary {
  stagedAttendance:number;
  contributionReviews:number;
  profileChanges:number;
  unresolvedObservations:number;
  duplicateCases:number;
  reconciliationMatches:number;
  reconciliationChanges:number;
  formAttendanceWarnings:number;
  openLeads:number;
  eventGroups:WorkEventGroup[];
  contributionGroups:WorkContributionGroup[];
}

export async function fetchWorkSummary():Promise<WorkSummary>{
  const [
    staged,
    contributions,
    profileChanges,
    observations,
    duplicates,
    reconciliationMatches,
    reconciliationChanges,
    formWarnings,
    leads,
  ]=await Promise.all([
    supabase.from('historical_attendance_import_rows')
      .select('id,event_name,event_date,matched_keluarga_event_id,matched_event_id,matched_core_volunteer_id,match_status,review_flags',{count:'exact'})
      .eq('decision','pending')
      .order('event_date',{ascending:true})
      .limit(500),
    supabase.from('maklom_contribution_review_queue')
      .select('id,event_title,status,occurred_at',{count:'exact'})
      .in('status',['pending','needs_review'])
      .order('occurred_at',{ascending:true})
      .limit(500),
    supabase.from('maklom_profile_change_review_queue').select('id',{count:'exact',head:true}).eq('status','pending'),
    supabase.from('maklom_profile_inbox_review_queue').select('id',{count:'exact',head:true}).in('status',['pending','needs_match']),
    supabase.from('suspected_duplicates').select('id',{count:'exact',head:true}).eq('decision','pending'),
    supabase.from('maklom_profile_reconciliation_rows').select('id',{count:'exact',head:true}).eq('match_status','needs_confirmation'),
    supabase.from('maklom_profile_reconciliation_changes').select('id',{count:'exact',head:true}).eq('status','pending'),
    supabase.from('attendance_reconciliations').select('id',{count:'exact',head:true}).eq('included',true).eq('review_acknowledged',false),
    supabase.from('volunteer_leads').select('id',{count:'exact',head:true}).not('status','in','(converted,not_selected,withdrawn)'),
  ]);

  const results=[staged,contributions,profileChanges,observations,duplicates,reconciliationMatches,reconciliationChanges,formWarnings,leads];
  const failed=results.find((result)=>result.error);
  if(failed?.error)throw failed.error;

  const eventMap=new Map<string,WorkEventGroup>();
  for(const row of staged.data||[]){
    const eventId=row.matched_keluarga_event_id
      ? 'keluarga:'+row.matched_keluarga_event_id
      : row.matched_event_id||null;
    const eventName=String(row.event_name||'Unknown event');
    const key=eventId||'name:'+eventName.toLowerCase()+'|'+String(row.event_date||'');
    const current=eventMap.get(key)||{
      key,
      eventId,
      eventName,
      eventDate:row.event_date||null,
      count:0,
      unresolvedIdentities:0,
      reviewRows:0,
    };
    current.count+=1;
    if(!row.matched_core_volunteer_id)current.unresolvedIdentities+=1;
    if(row.match_status==='needs_review'||(Array.isArray(row.review_flags)&&row.review_flags.length>0))current.reviewRows+=1;
    eventMap.set(key,current);
  }

  const contributionMap=new Map<string,WorkContributionGroup>();
  for(const row of contributions.data||[]){
    const eventTitle=String(row.event_title||'Untitled event');
    const current=contributionMap.get(eventTitle)||{eventTitle,count:0,needsReview:0,oldestOccurredAt:null};
    current.count+=1;
    if(row.status==='needs_review')current.needsReview+=1;
    const occurredAt=row.occurred_at?String(row.occurred_at):null;
    if(occurredAt&&(!current.oldestOccurredAt||occurredAt<current.oldestOccurredAt))current.oldestOccurredAt=occurredAt;
    contributionMap.set(eventTitle,current);
  }

  return{
    stagedAttendance:staged.count||0,
    contributionReviews:contributions.count||0,
    profileChanges:profileChanges.count||0,
    unresolvedObservations:observations.count||0,
    duplicateCases:duplicates.count||0,
    reconciliationMatches:reconciliationMatches.count||0,
    reconciliationChanges:reconciliationChanges.count||0,
    formAttendanceWarnings:formWarnings.count||0,
    openLeads:leads.count||0,
    eventGroups:[...eventMap.values()].sort((a,b)=>(a.eventDate||'9999').localeCompare(b.eventDate||'9999')||b.count-a.count),
    contributionGroups:[...contributionMap.values()].sort((a,b)=>b.needsReview-a.needsReview||b.count-a.count),
  };
}
