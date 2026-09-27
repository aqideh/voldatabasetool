import { supabase } from '../../lib/supabase';
import type { IntelligenceFilters, IntelligenceImpactRow, IntelligenceMonthlyRow, IntelligenceRetentionRow, IntelligenceSummary, VolunteerIntelligenceRow } from '../../lib/types';

function safe(value:string){return value.trim().replace(/[,%()]/g,' ');}

export async function fetchIntelligenceSummary():Promise<IntelligenceSummary>{
  const{data,error}=await supabase.from('maklom_intelligence_summary').select('*').maybeSingle();
  if(error)throw error;
  return (data||{
    total_volunteers:0,deployed_volunteers:0,repeat_volunteers:0,repeat_engagement_rate:null,active_last_90d:0,
    historical_credited_minutes:0,approved_keluarga_minutes:0,accepted_insights:0,accepted_reviews:0,unresolved_observations:0
  }) as IntelligenceSummary;
}

export async function fetchRetentionSummary(){
  const{data,error}=await supabase.from('maklom_retention_summary').select('*').order('window_days');
  if(error)throw error;
  return(data||[]) as IntelligenceRetentionRow[];
}

export async function fetchMonthlyParticipation(){
  const{data,error}=await supabase.from('maklom_participation_monthly').select('*').order('month',{ascending:false}).limit(18);
  if(error)throw error;
  return(data||[]) as IntelligenceMonthlyRow[];
}

function applyFilters(query:any,filters:IntelligenceFilters){
  const search=safe(filters.search);
  if(search){const p=`%${search}%`;query=query.or(`name.ilike.${p},email.ilike.${p},phone.ilike.${p}`);}
  if(filters.engagement==='deployed')query=query.gt('event_count',0);
  else if(filters.engagement==='repeat')query=query.eq('repeat_engaged',true);
  else if(filters.engagement==='active90')query=query.eq('active_last_90d',true);
  else if(filters.engagement==='inactive')query=query.eq('event_count',0);
  if(filters.recruitedYear)query=query.eq('recruited_year',filters.recruitedYear);
  return query;
}

export async function fetchVolunteerIntelligence(filters:IntelligenceFilters){
  const from=filters.page*filters.pageSize,to=from+filters.pageSize-1;
  let query=supabase.from('maklom_volunteer_intelligence').select('*',{count:'exact'});
  query=applyFilters(query,filters);
  if(filters.sort==='events')query=query.order('event_count',{ascending:false}).order('name');
  else if(filters.sort==='historical-hours')query=query.order('historical_credited_minutes',{ascending:false}).order('name');
  else if(filters.sort==='approved-hours')query=query.order('approved_keluarga_minutes',{ascending:false}).order('name');
  else if(filters.sort==='last-active')query=query.order('last_event_date',{ascending:false,nullsFirst:false}).order('name');
  else query=query.order('name');
  const{data,error,count}=await query.range(from,to);
  if(error)throw error;
  return{rows:(data||[]) as VolunteerIntelligenceRow[],count:count||0};
}

export async function fetchAllVolunteerIntelligence(filters:IntelligenceFilters){
  let query=supabase.from('maklom_volunteer_intelligence').select('*');
  query=applyFilters(query,filters);
  const{data,error}=await query.order('name').limit(10000);
  if(error)throw error;
  return(data||[]) as VolunteerIntelligenceRow[];
}


export async function fetchImpactSummary(){
  const{data,error}=await supabase.from('event_impact_metrics').select('label,value,unit');
  if(error)throw error;
  const grouped=new Map<string,IntelligenceImpactRow>();
  for(const row of data||[]){
    const label=String(row.label||'').trim();if(!label)continue;
    const unit=row.unit?String(row.unit).trim():null;
    const key=`${label.toLowerCase()}::${(unit||'').toLowerCase()}`;
    const current=grouped.get(key)||{label,unit,total:0,event_rows:0};
    current.total+=Number(row.value||0);current.event_rows+=1;grouped.set(key,current);
  }
  return[...grouped.values()].sort((a,b)=>b.event_rows-a.event_rows||a.label.localeCompare(b.label));
}
