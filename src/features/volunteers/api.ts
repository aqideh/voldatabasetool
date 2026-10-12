import { supabase } from '../../lib/supabase';
import type { VolunteerRow, VolunteerUpdate } from '../../lib/types';
import type {
  VolunteerSearchFilters,
  VolunteerSearchOptions,
  VolunteerSearchResult,
} from './search-types';
import type { VolunteerSearchRow } from './search-row';

const REFRESH_SELECT='*';

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
  const{data,error}=await (supabase as any).rpc('maklom_search_volunteers',{
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
  const{data,error}=await (supabase as any).rpc('maklom_volunteer_search_options');
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
  const refreshed=await supabase.from('maklom_volunteer_search_v2').select(REFRESH_SELECT).eq('id',id).maybeSingle();
  if(refreshed.error)throw refreshed.error;
  if(!refreshed.data)throw new Error('Volunteer profile could not be reloaded.');
  return refreshed.data as VolunteerRow;
}

export interface VolunteerProfileDetails {
  privateDetails:Record<string,unknown>|null;
  familyProfile:Record<string,unknown>|null;
  events:Array<{event_key:string;event_title:string;event_date:string;has_historical_source:boolean;has_keluarga_source:boolean}>;
  contributions:Array<{id:string;event_title:string|null;occurred_at:string;status:string;approved_minutes:number|null;operational_minutes:number|null;approval_note:string|null}>;
  changeRequests:Array<{id:string;field_name:string;status:string;old_value:string|null;new_value:string|null;source_changed_at:string}>;
  audit:Array<{id:number;actor_user_id:string|null;action:string;occurred_at:string}>;
}
export async function fetchVolunteerProfileDetails(coreId:string,maklomId:string):Promise<VolunteerProfileDetails>{
  const [priv,profile,events,contributions,changes,audit]=await Promise.all([
    supabase.from('volunteer_private_details').select('*').eq('volunteer_id',coreId).maybeSingle(),
    supabase.from('keluarga_volunteer_profiles').select('*').eq('volunteer_id',coreId).maybeSingle(),
    supabase.from('maklom_event_participation').select('event_key,event_title,event_date,has_historical_source,has_keluarga_source').eq('core_volunteer_id',coreId).order('event_date',{ascending:false}).limit(500),
    supabase.from('volunteer_contributions').select('id,event_title,occurred_at,status,approved_minutes,operational_minutes,approval_note').eq('volunteer_id',coreId).order('occurred_at',{ascending:false}).limit(200),
    supabase.from('maklom_profile_change_review_queue').select('id,field_name,status,old_value,new_value,source_changed_at').eq('volunteer_id',coreId).order('source_changed_at',{ascending:false}).limit(50),
    supabase.from('audit_log').select('id,actor_user_id,action,occurred_at').eq('entity_type','volunteers').eq('entity_id',maklomId).order('occurred_at',{ascending:false}).limit(50),
  ]);
  const failed=[priv,profile,events,contributions,changes,audit].find((result)=>result.error);
  if(failed?.error)throw failed.error;
  return{
    privateDetails:(priv.data??null) as Record<string,unknown>|null,
    familyProfile:(profile.data??null) as Record<string,unknown>|null,
    events:(events.data??[]) as VolunteerProfileDetails['events'],
    contributions:(contributions.data??[]) as VolunteerProfileDetails['contributions'],
    changeRequests:(changes.data??[]) as VolunteerProfileDetails['changeRequests'],
    audit:(audit.data??[]) as VolunteerProfileDetails['audit'],
  };
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
