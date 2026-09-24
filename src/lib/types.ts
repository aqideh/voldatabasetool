export type AppRole = 'viewer' | 'editor' | 'admin';

export interface AppMember { user_id: string; role: AppRole; active: boolean; }

export interface VolunteerRow {
  id:string; core_volunteer_id:string; volunteer_code:string; name:string; nric:string|null; phone:string|null; email:string|null; gender:string|null;
  address:string|null; recruited_year:number|null; chat_session:string|null; chat_session_date:string|null;
  interests:string|null; languages_spoken:string|null; programmes_registered:string[]; tags:string[];
  emergency_name:string|null; emergency_phone:string|null; shirt_size:string|null; dietary:string|null;
  notes:string|null; updated_at:string; row_version:number;
}
export type VolunteerUpdate = Omit<VolunteerRow,'id'|'core_volunteer_id'|'volunteer_code'|'updated_at'|'row_version'>;

export interface VolunteerFilters {
  search:string; tag:string|null; recruitedYear:number|null;
  sort:'name-asc'|'name-desc'|'newest'|'oldest'; page:number; pageSize:number;
}

export type VolunteerLeadStatus='new'|'reviewing'|'contacted'|'accepted'|'converted'|'not_selected'|'withdrawn';
export interface VolunteerLead {
  id:string;source:'formsg'|'manual';source_form_id:string|null;source_submission_id:string|null;submitted_at:string|null;
  status:VolunteerLeadStatus;full_name:string;email:string|null;phone:string|null;interest_area:string|null;motivation:string|null;
  skills_experience:string|null;availability_notes:string|null;referral_source:string|null;staff_notes:string|null;
  converted_volunteer_id:string|null;converted_at:string|null;created_at:string;updated_at:string;row_version:number;
}
export interface LeadFilters {search:string;status:VolunteerLeadStatus|null;page:number;pageSize:number;}

export interface EventRow {id:string;name:string;start_date:string;end_date:string;programme:string|null;venue:string|null;notes:string|null;status:'active'|'archived';updated_at:string;row_version:number;}
export interface EventShiftRow {id:string;event_id:string;name:string;shift_date:string;start_time:string|null;end_time:string|null;notes:string|null;row_version:number;}
export interface EventImpactMetricRow {id:string;event_id:string;label:string;value:number;unit:string|null;row_version:number;}

export interface AttendanceRow {
  id:string;volunteer_id:string|null;name:string;email:string|null;contact:string|null;attended:boolean;event_name:string;
  event_date:string;duration_minutes:number;sign_in_at:string|null;sign_out_at:string|null;calculated_duration_minutes:number|null;
  staff_credited_duration_minutes:number|null;staff_credit_note:string|null;event_id:string|null;shift_id:string|null;shift_label:string|null;row_version:number;
}
export interface AttendanceFilters {search:string;eventName:string|null;attended:'all'|'yes'|'no';page:number;pageSize:number;}

export interface DuplicateRow {id:string;level:'medium'|'low';existing_volunteer_id:string|null;incoming:Record<string,unknown>;decision:'pending'|'merge'|'add'|'dismiss';reason:string|null;created_at:string;row_version:number;}
export interface FormImportBatch {id:string;sign_in_filename:string|null;sign_out_filename:string|null;sign_in_count:number;sign_out_count:number;status:'pending_sync'|'committed';warning_count:number;completed_at:string|null;created_at:string;row_version:number;}
export interface FormSubmission {
  id:string;batch_id:string;submission_type:'sign_in'|'sign_out';source_response_id:string;source_file_name:string|null;submitted_at:string;
  submitted_date:string;full_name:string;email:string|null;phone:string|null;event_name:string;shirt_quantity:number;shirt_size:string|null;
  age_group:string|null;gender:string|null;volunteer_tenure:string|null;volunteer_frequency:string|null;briefing_rating:number|null;
  onboarding_rating:number|null;role_satisfaction_rating:number|null;staff_support_rating:number|null;improvement_feedback:string|null;
  recommendation:string|null;referral_email:string|null;raw_payload:Record<string,unknown>;
}
export interface AttendanceReconciliation {
  id:string;batch_id:string;volunteer_id:string|null;sign_in_submission_id:string|null;sign_out_submission_id:string|null;
  event_name:string;event_date:string;sign_in_at:string|null;sign_out_at:string|null;calculated_duration_minutes:number|null;
  staff_credited_duration_minutes:number|null;staff_credit_note:string|null;match_status:string;match_confidence:number;match_reason:string|null;
  review_flags:string[];included:boolean;review_acknowledged:boolean;row_version:number;
}
