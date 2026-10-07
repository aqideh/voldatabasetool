import { supabase } from '../../lib/supabase';
import type { IntelligenceDataset, IntelligenceDateRange, IntelligenceFilters, IntelligenceImpactRow, IntelligenceMonthlyRow, IntelligenceProgrammeBreakdown, IntelligenceReport, IntelligenceRetentionRow, IntelligenceSummary, VolunteerIntelligenceRow } from '../../lib/types';

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

export async function fetchProgrammeBreakdown(){
  const pageSize=1000;
  let from=0;
  const volunteerProgrammes=new Map<string,Map<string,string>>();
  while(true){
    const{data,error}=await supabase
      .from('maklom_volunteer_intelligence')
      .select('core_volunteer_id,programmes_registered')
      .order('core_volunteer_id')
      .range(from,from+pageSize-1);
    if(error)throw error;
    const rows=data||[];
    for(const row of rows){
      const volunteerId=String(row.core_volunteer_id||'').trim();
      if(!volunteerId)continue;
      const programmes=volunteerProgrammes.get(volunteerId)||new Map<string,string>();
      for(const raw of row.programmes_registered||[]){
        const label=String(raw||'').trim();
        if(!label)continue;
        const key=label.toLowerCase();
        if(!programmes.has(key))programmes.set(key,label);
      }
      volunteerProgrammes.set(volunteerId,programmes);
    }
    if(rows.length<pageSize)break;
    from+=pageSize;
  }

  const counts=new Map<string,{programme:string;unique_volunteers:number}>();
  let taggedUniqueVolunteers=0;
  let multiProgrammeVolunteers=0;
  for(const programmes of volunteerProgrammes.values()){
    if(programmes.size>0)taggedUniqueVolunteers+=1;
    if(programmes.size>1)multiProgrammeVolunteers+=1;
    for(const[key,label]of programmes){
      const current=counts.get(key);
      counts.set(key,{programme:current?.programme||label,unique_volunteers:(current?.unique_volunteers||0)+1});
    }
  }

  return{
    total_unique_volunteers:volunteerProgrammes.size,
    tagged_unique_volunteers:taggedUniqueVolunteers,
    untagged_unique_volunteers:volunteerProgrammes.size-taggedUniqueVolunteers,
    multi_programme_volunteers:multiProgrammeVolunteers,
    rows:[...counts.values()].sort((a,b)=>b.unique_volunteers-a.unique_volunteers||a.programme.localeCompare(b.programme)),
  };
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


const SG_DATE_FORMATTER=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'});

function singaporeDate(value:string|Date|null|undefined):string|null{
  if(!value)return null;
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  const parts=SG_DATE_FORMATTER.formatToParts(date);
  const year=parts.find((p)=>p.type==='year')?.value;
  const month=parts.find((p)=>p.type==='month')?.value;
  const day=parts.find((p)=>p.type==='day')?.value;
  return year&&month&&day?`${year}-${month}-${day}`:null;
}

function addDays(value:string,days:number){
  const date=new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function inRange(value:string|null|undefined,range:IntelligenceDateRange){
  if(!value)return false;
  return(!range.from||value>=range.from)&&(!range.to||value<=range.to);
}

function monthStart(value:string){return `${value.slice(0,7)}-01`;}

async function fetchPagedRows<T>(table:string,columns:string,orderColumns:string[]):Promise<T[]>{
  const pageSize=1000;
  const result:T[]=[];
  for(let from=0;;from+=pageSize){
    let query=supabase.from(table).select(columns);
    for(const column of orderColumns)query=query.order(column);
    const{data,error}=await query.range(from,from+pageSize-1);
    if(error)throw error;
    const rows=(data||[]) as T[];
    result.push(...rows);
    if(rows.length<pageSize)break;
  }
  return result;
}

export async function fetchIntelligenceDataset():Promise<IntelligenceDataset>{
  const[volunteers,participation,attendance,contributions,observations,impacts,events]=await Promise.all([
    fetchPagedRows<IntelligenceDataset['volunteers'][number]>('maklom_volunteer_intelligence','maklom_volunteer_id,core_volunteer_id,name,email,phone,recruited_year,tags,programmes_registered',['core_volunteer_id']),
    fetchPagedRows<IntelligenceDataset['participation'][number]>('maklom_event_participation','core_volunteer_id,event_key,event_date',['core_volunteer_id','event_key']),
    fetchPagedRows<IntelligenceDataset['attendance'][number]>('attendance_log','volunteer_id,event_date,attended,duration_minutes,calculated_duration_minutes,staff_credited_duration_minutes',['id']),
    fetchPagedRows<IntelligenceDataset['contributions'][number]>('volunteer_contributions','volunteer_id,occurred_at,approved_minutes,status',['id']),
    fetchPagedRows<IntelligenceDataset['observations'][number]>('maklom_profile_inbox','volunteer_id,source_kind,status,payload,reviewed_at,created_at',['id']),
    fetchPagedRows<IntelligenceDataset['impacts'][number]>('event_impact_metrics','event_id,label,value,unit',['id']),
    fetchPagedRows<IntelligenceDataset['events'][number]>('events','id,start_date,end_date,created_at',['id']),
  ]);
  return{volunteers,participation,attendance,contributions,observations,impacts,events};
}

function programmeBreakdown(volunteers:IntelligenceDataset['volunteers']):IntelligenceProgrammeBreakdown{
  const counts=new Map<string,{programme:string;unique_volunteers:number}>();
  let tagged=0;
  let multiple=0;
  for(const volunteer of volunteers){
    const unique=new Map<string,string>();
    for(const raw of volunteer.programmes_registered||[]){
      const label=String(raw||'').trim();
      if(!label)continue;
      const key=label.toLowerCase();
      if(!unique.has(key))unique.set(key,label);
    }
    if(unique.size>0)tagged+=1;
    if(unique.size>1)multiple+=1;
    for(const[key,label]of unique){
      const current=counts.get(key);
      counts.set(key,{programme:current?.programme||label,unique_volunteers:(current?.unique_volunteers||0)+1});
    }
  }
  return{
    total_unique_volunteers:volunteers.length,
    tagged_unique_volunteers:tagged,
    untagged_unique_volunteers:volunteers.length-tagged,
    multi_programme_volunteers:multiple,
    rows:[...counts.values()].sort((a,b)=>b.unique_volunteers-a.unique_volunteers||a.programme.localeCompare(b.programme)),
  };
}

export function buildIntelligenceReport(dataset:IntelligenceDataset,range:IntelligenceDateRange):IntelligenceReport{
  const today=singaporeDate(new Date())||new Date().toISOString().slice(0,10);
  const asOf=range.to&&range.to<today?range.to:today;
  const activeCutoff=addDays(asOf,-89);
  const maklomToCore=new Map(dataset.volunteers.map((v)=>[v.maklom_volunteer_id,v.core_volunteer_id]));

  const participationByVolunteer=new Map<string,{count:number;first:string|null;last:string|null;events90:number}>();
  const filteredParticipation=dataset.participation.filter((row)=>inRange(row.event_date,range));
  for(const row of filteredParticipation){
    const current=participationByVolunteer.get(row.core_volunteer_id)||{count:0,first:null,last:null,events90:0};
    current.count+=1;
    if(!current.first||row.event_date<current.first)current.first=row.event_date;
    if(!current.last||row.event_date>current.last)current.last=row.event_date;
    if(row.event_date>=activeCutoff&&row.event_date<=asOf)current.events90+=1;
    participationByVolunteer.set(row.core_volunteer_id,current);
  }

  const historicalMinutes=new Map<string,number>();
  const filteredAttendance=dataset.attendance.filter((row)=>row.attended&&inRange(row.event_date,range));
  for(const row of filteredAttendance){
    if(!row.volunteer_id)continue;
    const coreId=maklomToCore.get(row.volunteer_id);
    if(!coreId)continue;
    const minutes=Number(row.staff_credited_duration_minutes??row.calculated_duration_minutes??row.duration_minutes??0);
    historicalMinutes.set(coreId,(historicalMinutes.get(coreId)||0)+Math.max(0,Number.isFinite(minutes)?minutes:0));
  }

  const approvedMinutes=new Map<string,number>();
  const approvedRows:Array<{volunteer_id:string;date:string;minutes:number}>=[];
  for(const row of dataset.contributions){
    if(row.status!=='approved')continue;
    const date=singaporeDate(row.occurred_at);
    if(!date||!inRange(date,range))continue;
    const minutes=Math.max(0,Number(row.approved_minutes||0));
    approvedMinutes.set(row.volunteer_id,(approvedMinutes.get(row.volunteer_id)||0)+minutes);
    approvedRows.push({volunteer_id:row.volunteer_id,date,minutes});
  }

  const observationCounts=new Map<string,{insights:number;reviews:number;followUps:number}>();
  const filteredObservations=dataset.observations.filter((row)=>{
    const date=singaporeDate(row.reviewed_at||row.created_at);
    return Boolean(date&&inRange(date,range));
  });
  for(const row of filteredObservations){
    if(!row.volunteer_id||row.status!=='accepted')continue;
    const current=observationCounts.get(row.volunteer_id)||{insights:0,reviews:0,followUps:0};
    if(row.source_kind==='insight')current.insights+=1;
    if(row.source_kind==='review'){
      current.reviews+=1;
      if(row.payload?.follow_up_required===true)current.followUps+=1;
    }
    observationCounts.set(row.volunteer_id,current);
  }

  const volunteers:VolunteerIntelligenceRow[]=dataset.volunteers.map((base)=>{
    const participation=participationByVolunteer.get(base.core_volunteer_id)||{count:0,first:null,last:null,events90:0};
    const observations=observationCounts.get(base.core_volunteer_id)||{insights:0,reviews:0,followUps:0};
    return{
      ...base,
      event_count:participation.count,
      first_event_date:participation.first,
      last_event_date:participation.last,
      repeat_engaged:participation.count>=2,
      events_last_90d:participation.events90,
      active_last_90d:participation.events90>0,
      historical_credited_minutes:historicalMinutes.get(base.core_volunteer_id)||0,
      approved_keluarga_minutes:approvedMinutes.get(base.core_volunteer_id)||0,
      accepted_insights:observations.insights,
      accepted_reviews:observations.reviews,
      accepted_follow_up_reviews:observations.followUps,
    };
  });

  const deployed=volunteers.filter((row)=>row.event_count>0).length;
  const repeat=volunteers.filter((row)=>row.repeat_engaged).length;
  const summary:IntelligenceSummary={
    total_volunteers:volunteers.length,
    deployed_volunteers:deployed,
    repeat_volunteers:repeat,
    repeat_engagement_rate:deployed?Math.round((1000*repeat)/deployed)/10:null,
    active_last_90d:volunteers.filter((row)=>row.active_last_90d).length,
    historical_credited_minutes:volunteers.reduce((sum,row)=>sum+row.historical_credited_minutes,0),
    approved_keluarga_minutes:volunteers.reduce((sum,row)=>sum+row.approved_keluarga_minutes,0),
    accepted_insights:volunteers.reduce((sum,row)=>sum+row.accepted_insights,0),
    accepted_reviews:volunteers.reduce((sum,row)=>sum+row.accepted_reviews,0),
    unresolved_observations:filteredObservations.filter((row)=>row.status==='pending'||row.status==='needs_match').length,
  };

  const eventsByVolunteer=new Map<string,string[]>();
  for(const row of dataset.participation){
    const dates=eventsByVolunteer.get(row.core_volunteer_id)||[];
    dates.push(row.event_date);
    eventsByVolunteer.set(row.core_volunteer_id,dates);
  }
  const firstEventRows:Array<{first:string;second:string|null}>=[];
  for(const dates of eventsByVolunteer.values()){
    const ordered=[...new Set(dates)].sort();
    const first=ordered[0];
    if(!first||!inRange(first,range)||first>asOf)continue;
    const second=ordered.find((date)=>date>first)||null;
    firstEventRows.push({first,second});
  }
  const cohortStart=range.from||firstEventRows.map((row)=>row.first).sort()[0]||null;
  const cohortEnd=range.to||asOf;
  const retention:IntelligenceRetentionRow[]=[30,60,90].map((days)=>{
    const matureCutoff=addDays(asOf,-days);
    const eligible=firstEventRows.filter((row)=>row.first<=matureCutoff);
    const retained=eligible.filter((row)=>row.second&&row.second<=addDays(row.first,days)).length;
    return{
      cohort_year:cohortStart?Number(cohortStart.slice(0,4)):null,
      cohort_start:cohortStart,
      cohort_end:cohortEnd,
      window_days:days,
      eligible_volunteers:eligible.length,
      retained_volunteers:retained,
      retention_rate:eligible.length?Math.round((1000*retained)/eligible.length)/10:null,
      as_of_date:asOf,
    };
  });

  const monthlyParticipation=new Map<string,{volunteers:Map<string,number>;participations:number}>();
  for(const row of filteredParticipation){
    const month=monthStart(row.event_date);
    const current=monthlyParticipation.get(month)||{volunteers:new Map<string,number>(),participations:0};
    current.participations+=1;
    current.volunteers.set(row.core_volunteer_id,(current.volunteers.get(row.core_volunteer_id)||0)+1);
    monthlyParticipation.set(month,current);
  }
  const monthlyHistorical=new Map<string,number>();
  for(const row of filteredAttendance){
    const month=monthStart(row.event_date);
    const minutes=Number(row.staff_credited_duration_minutes??row.calculated_duration_minutes??row.duration_minutes??0);
    monthlyHistorical.set(month,(monthlyHistorical.get(month)||0)+Math.max(0,Number.isFinite(minutes)?minutes:0));
  }
  const monthlyApproved=new Map<string,number>();
  for(const row of approvedRows){
    const month=monthStart(row.date);
    monthlyApproved.set(month,(monthlyApproved.get(month)||0)+row.minutes);
  }
  const months=new Set([...monthlyParticipation.keys(),...monthlyHistorical.keys(),...monthlyApproved.keys()]);
  const monthly:IntelligenceMonthlyRow[]=[...months].sort((a,b)=>b.localeCompare(a)).map((month)=>{
    const participation=monthlyParticipation.get(month);
    const counts=participation?[...participation.volunteers.values()]:[];
    return{
      month,
      unique_volunteers:participation?.volunteers.size||0,
      event_participations:participation?.participations||0,
      repeat_volunteers:counts.filter((count)=>count>=2).length,
      historical_credited_minutes:monthlyHistorical.get(month)||0,
      approved_keluarga_minutes:monthlyApproved.get(month)||0,
    };
  });

  const eventDates=new Map<string,string|null>();
  for(const event of dataset.events){
    eventDates.set(event.id,event.start_date||event.end_date||singaporeDate(event.created_at));
  }
  const groupedImpact=new Map<string,IntelligenceImpactRow>();
  for(const row of dataset.impacts){
    const eventDate=eventDates.get(row.event_id)||null;
    if((range.from||range.to)&&!inRange(eventDate,range))continue;
    const label=String(row.label||'').trim();
    if(!label)continue;
    const unit=row.unit?String(row.unit).trim():null;
    const key=`${label.toLowerCase()}::${(unit||'').toLowerCase()}`;
    const current=groupedImpact.get(key)||{label,unit,total:0,event_rows:0};
    current.total+=Number(row.value||0);
    current.event_rows+=1;
    groupedImpact.set(key,current);
  }
  const impact=[...groupedImpact.values()].sort((a,b)=>b.event_rows-a.event_rows||a.label.localeCompare(b.label));

  const boundsDates:string[]=[];
  for(const row of dataset.participation)if(row.event_date)boundsDates.push(row.event_date);
  for(const row of dataset.attendance)if(row.event_date)boundsDates.push(row.event_date);
  for(const row of dataset.contributions){const date=singaporeDate(row.occurred_at);if(date)boundsDates.push(date);}
  const sortedBounds=boundsDates.sort();

  return{
    bounds:{min_date:sortedBounds[0]||null,max_date:sortedBounds.at(-1)||null},
    summary,
    retention,
    monthly,
    programmes:programmeBreakdown(dataset.volunteers),
    impact,
    volunteers,
  };
}
