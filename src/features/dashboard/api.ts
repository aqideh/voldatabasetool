import { supabase } from '../../lib/supabase';

export interface DashboardSummary {
  volunteers:number; leads:number; attendanceRows:number; attendedRows:number; creditedMinutes:number; events:number; shifts:number; openDuplicateCases:number;
  recruitedByYear:Array<{year:string;count:number}>;
  deployedByYear:Array<{year:string;count:number}>;
  programmeCounts:Array<{programme:string;count:number}>;
  retention:{year:string;noShowRate:number|null;retention30:number|null;retention60:number|null;retention90:number|null;dropOff90:number|null};
}

async function exactCount(table:string,apply?:(query:any)=>any){let query=supabase.from(table).select('*',{count:'exact',head:true});if(apply)query=apply(query);const{count,error}=await query;if(error)throw error;return count||0;}
function pct(a:number,b:number){return b?Math.round((a/b)*1000)/10:null;}

export async function fetchDashboardSummary():Promise<DashboardSummary>{
  const [volunteers,leads,attendanceRows,attendedRows,events,shifts,openDuplicateCases,attendance,volunteerRows]=await Promise.all([
    exactCount('volunteers'),
    exactCount('volunteer_leads',(q)=>q.not('status','in','(converted,not_selected,withdrawn)')),
    exactCount('attendance_log'),
    exactCount('attendance_log',(q)=>q.eq('attended',true)),
    exactCount('events',(q)=>q.eq('status','active')),
    exactCount('event_shifts'),
    exactCount('suspected_duplicates',(q)=>q.eq('decision','pending')),
    supabase.from('attendance_log').select('volunteer_id,email,contact,name,event_name,event_date,attended,duration_minutes,calculated_duration_minutes,staff_credited_duration_minutes'),
    supabase.from('maklom_volunteer_search_directory').select('id,recruited_year,programmes_registered'),
  ]);
  if(attendance.error)throw attendance.error;if(volunteerRows.error)throw volunteerRows.error;
  const rows=attendance.data||[], people=volunteerRows.data||[];
  const creditedMinutes=rows.reduce((sum,row)=>sum+(row.attended?Number(row.staff_credited_duration_minutes??row.calculated_duration_minutes??row.duration_minutes??0):0),0);
  const recruited=new Map<string,number>();
  for(const person of people){if(person.recruited_year){const y=String(person.recruited_year);recruited.set(y,(recruited.get(y)||0)+1);}}
  const deployed=new Map<string,Set<string>>();
  for(const row of rows){if(!row.event_date)continue;const y=String(row.event_date).slice(0,4);const key=row.volunteer_id||String(row.email||'').toLowerCase()||String(row.contact||'').replace(/\D/g,'')||String(row.name||'').toLowerCase();if(!key)continue;if(!deployed.has(y))deployed.set(y,new Set());deployed.get(y)!.add(key);}
  const programmeMap=new Map<string,number>();
  for(const person of people){for(const programme of person.programmes_registered||[])programmeMap.set(programme,(programmeMap.get(programme)||0)+1);}
  const currentYear=String(new Date().getFullYear());
  const completed=rows.filter((r)=>String(r.event_date||'').startsWith(currentYear));
  const noShows=completed.filter((r)=>!r.attended).length;
  const byVolunteer=new Map<string,string[]>();
  for(const row of rows.filter((r)=>r.attended&&r.event_date)){
    const key=row.volunteer_id||String(row.email||'').toLowerCase()||String(row.contact||'').replace(/\D/g,'');if(!key)continue;
    const arr=byVolunteer.get(key)||[];if(!arr.includes(row.event_date))arr.push(row.event_date);byVolunteer.set(key,arr.sort());
  }
  function retention(days:number){let eligible=0,retained=0;const latest=rows.map((r)=>r.event_date).filter(Boolean).sort().at(-1);if(!latest)return null;const latestMs=new Date(latest+'T00:00:00Z').getTime();
    for(const dates of byVolunteer.values()){if(!dates[0]?.startsWith(currentYear))continue;const firstMs=new Date(dates[0]+'T00:00:00Z').getTime();if((latestMs-firstMs)/86400000<days)continue;eligible++;if(dates.slice(1).some((d)=>(new Date(d+'T00:00:00Z').getTime()-firstMs)/86400000<=days))retained++;}
    return pct(retained,eligible);
  }
  const r90=retention(90);
  return{
    volunteers,leads,attendanceRows,attendedRows,creditedMinutes,events,shifts,openDuplicateCases,
    recruitedByYear:[...recruited.entries()].sort().map(([year,count])=>({year,count})),
    deployedByYear:[...deployed.entries()].sort().map(([year,set])=>({year,count:set.size})),
    programmeCounts:[...programmeMap.entries()].sort((a,b)=>b[1]-a[1]).map(([programme,count])=>({programme,count})),
    retention:{year:currentYear,noShowRate:pct(noShows,completed.length),retention30:retention(30),retention60:retention(60),retention90:r90,dropOff90:r90==null?null:Math.round((100-r90)*10)/10}
  };
}
