import { supabase } from '../../lib/supabase';
import type { VolunteerRow, VolunteerUpdate } from '../../lib/types';
import type {
  VolunteerSearchFilters,
  VolunteerSearchOptions,
  VolunteerSearchResult,
} from './search-types';
import type { VolunteerSearchRow } from './search-row';

const REFRESH_SELECT='id,core_volunteer_id,volunteer_code,name,nric,email,phone,gender,address,neighbourhood,planning_area,electoral_division,recruited_year,chat_session,chat_session_date,interests,languages_spoken,programmes_registered,tags,emergency_name,emergency_phone,shirt_size,dietary,notes,updated_at,row_version,attendance_rows,total_credited_minutes,last_active,first_tag';

function normalizeSearchPayload(data:unknown):VolunteerSearchResult {
  const result=(data??{}) as Partial<VolunteerSearchResult>;
  return {
    rows:Array.isArray(result.rows)?result.rows as VolunteerSearchRow[]:[],
    count:typeof result.count==='number'?result.count:0,
    page:typeof result.page==='number'?result.page:0,
    pageSize:typeof result.pageSize==='number'?result.pageSize:50,
  };
}

export async function fetchVolunteers(filters:VolunteerSearchFilters):Promise<VolunteerSearchResult>{
  const{data,error}=await supabase.rpc('maklom_search_volunteers',{
    p_query:filters.query,
    p_search:filters.search.trim(),
    p_sort:filters.sort,
    p_page:filters.page,
    p_page_size:filters.pageSize,
  });
  if(error)throw error;
  return normalizeSearchPayload(data);
}

export async function fetchVolunteerExportRows(filters:VolunteerSearchFilters){
  const rows:VolunteerSearchRow[]=[];
  let page=0;
  const pageSize=500;
  while(page<20){
    const result=await fetchVolunteers({...filters,page,pageSize});
    rows.push(...result.rows);
    if(rows.length>=result.count||result.rows.length<pageSize)break;
    page+=1;
  }
  return rows;
}

export async function fetchVolunteerFilterOptions():Promise<VolunteerSearchOptions>{
  const{data,error}=await supabase.rpc('maklom_volunteer_search_options');
  if(error)throw error;
  const result=(data??{}) as Partial<VolunteerSearchOptions>&{error?:string};
  if(result.error)throw new Error(result.error);
  const list=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
  return{
    tags:list(result.tags),
    programmes:list(result.programmes),
    genders:list(result.genders),
    shirtSizes:list(result.shirtSizes),
    planningAreas:list(result.planningAreas),
    electoralDivisions:list(result.electoralDivisions),
    events:list(result.events),
  };
}

export async function updateVolunteer(id:string,expectedVersion:number,update:VolunteerUpdate):Promise<VolunteerRow>{
  const{data,error}=await supabase.from('volunteers').update(update).eq('id',id).eq('row_version',expectedVersion).select('id').maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('This volunteer was updated in another session. Reload before saving again.');
  const refreshed=await supabase.from('maklom_volunteer_search_directory').select(REFRESH_SELECT).eq('id',id).maybeSingle();
  if(refreshed.error)throw refreshed.error;
  if(!refreshed.data)throw new Error('Volunteer profile could not be reloaded.');
  return refreshed.data as VolunteerRow;
}

export interface VolunteerRemovalPreflight {
  eligible:boolean;
  blockers:string[];
  volunteerId:string;
  volunteerCode:string;
  displayName:string;
  hasAccount:boolean;
  hasProfilePhoto:boolean;
  registrationCount:number;
  rosterCount:number;
  recruitmentApplicationCount:number;
  pointEntryCount:number;
  badgeCount:number;
}

export interface VolunteerRemovalResult {
  removed:true;
  volunteerCode:string;
  registrationCount:number;
  rosterCount:number;
  removedPointEntries:number;
  removedBadges:number;
}

const KELUARGA_ADMIN_API='https://keluarga.mendaki.org.sg/api/maklom/admin-volunteer';

async function callVolunteerAdminApi<T>(payload:Record<string,unknown>):Promise<T>{
  const sessionResult=await supabase.auth.getSession();
  const token=sessionResult.data.session?.access_token;
  if(!token)throw new Error('Your MakLom session has expired. Sign in again.');

  const response=await fetch(KELUARGA_ADMIN_API,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify(payload),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=typeof body.error==='string'?body.error:'Volunteer admin action failed.';
    const blockers=Array.isArray(body.blockers)?body.blockers.filter((item:unknown)=>typeof item==='string'):[];
    throw new Error(blockers.length?`${message} ${blockers.join(' ')}`:message);
  }
  return body as T;
}

export function inspectVolunteerRemoval(coreVolunteerId:string):Promise<VolunteerRemovalPreflight>{
  return callVolunteerAdminApi<VolunteerRemovalPreflight>({action:'inspect',coreVolunteerId});
}

export function removeTestVolunteer(coreVolunteerId:string,confirmation:string):Promise<VolunteerRemovalResult>{
  return callVolunteerAdminApi<VolunteerRemovalResult>({action:'remove-test-record',coreVolunteerId,confirmation});
}
