import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
export type MaklomRole='superadmin'|'platform_admin'|'volunteer_manager'|'data_steward'|'operations_staff'|'reporting_viewer';
export interface MaklomAccess {user_id:string;role:MaklomRole;active:boolean;}
export type Permission='staff.manage'|'analytics.read'|'volunteers.read'|'volunteers.write'|'leads.read'|'leads.write'|'data.read'|'data.write'|'ops.read'|'ops.write'|'audit.read';
const permissions:Record<MaklomRole,Permission[]>={
  superadmin:['staff.manage','analytics.read','volunteers.read','volunteers.write','leads.read','leads.write','data.read','data.write','ops.read','ops.write','audit.read'],
  platform_admin:['analytics.read','volunteers.read','volunteers.write','leads.read','leads.write','data.read','data.write','ops.read','ops.write','audit.read'],
  volunteer_manager:['analytics.read','volunteers.read','volunteers.write','leads.read','leads.write','data.read','data.write','ops.read','ops.write'],
  data_steward:['analytics.read','volunteers.read','volunteers.write','leads.read','leads.write','data.read','data.write'],
  operations_staff:['analytics.read','ops.read','ops.write'],
  reporting_viewer:['analytics.read']
};
export function hasAccess(access:MaklomAccess|null,permission:Permission){return !!access?.active&&permissions[access.role]?.includes(permission);}
export async function fetchMaklomAccess(session:Session):Promise<MaklomAccess|null>{
  const {data,error}=await supabase.from('maklom_staff_access').select('user_id,role,active').eq('user_id',session.user.id).maybeSingle();
  if(error)throw error;
  return data as MaklomAccess|null;
}
