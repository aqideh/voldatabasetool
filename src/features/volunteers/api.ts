import { supabase } from '../../lib/supabase';
import type { VolunteerFilters, VolunteerRow, VolunteerUpdate } from '../../lib/types';

const SELECT='id,name,nric,email,phone,gender,address,recruited_year,chat_session,chat_session_date,interests,languages_spoken,programmes_registered,tags,emergency_name,emergency_phone,shirt_size,dietary,notes,updated_at,row_version';
function safeSearchTerm(value:string){return value.trim().replace(/[,%()]/g,' ');}

export async function fetchVolunteers(filters:VolunteerFilters){
  const from=filters.page*filters.pageSize,to=from+filters.pageSize-1;
  let query=supabase.from('volunteers').select(SELECT,{count:'exact'});
  const search=safeSearchTerm(filters.search);
  if(search){const pattern=`%${search}%`;query=query.or([`name.ilike.${pattern}`,`email.ilike.${pattern}`,`phone.ilike.${pattern}`,`notes.ilike.${pattern}`,`interests.ilike.${pattern}`].join(','));}
  if(filters.tag)query=query.contains('tags',[filters.tag]);if(filters.recruitedYear)query=query.eq('recruited_year',filters.recruitedYear);
  if(filters.sort==='name-desc')query=query.order('name',{ascending:false});else if(filters.sort==='newest')query=query.order('updated_at',{ascending:false});else if(filters.sort==='oldest')query=query.order('updated_at',{ascending:true});else query=query.order('name',{ascending:true});
  const{data,error,count}=await query.range(from,to);if(error)throw error;return{rows:(data||[]) as VolunteerRow[],count:count||0};
}
export async function fetchVolunteerFilterOptions(){
  const{data,error}=await supabase.from('volunteers').select('tags,recruited_year');if(error)throw error;
  const tags=new Set<string>(),years=new Set<number>();for(const row of data||[]){for(const tag of row.tags||[])if(tag)tags.add(tag);if(row.recruited_year)years.add(row.recruited_year);}
  return{tags:[...tags].sort((a,b)=>a.localeCompare(b)),years:[...years].sort((a,b)=>b-a)};
}
export async function updateVolunteer(id:string,expectedVersion:number,update:VolunteerUpdate):Promise<VolunteerRow>{
  const{data,error}=await supabase.from('volunteers').update(update).eq('id',id).eq('row_version',expectedVersion).select(SELECT).maybeSingle();
  if(error)throw error;if(!data)throw new Error('This volunteer was updated in another session. Reload before saving again.');return data as VolunteerRow;
}
