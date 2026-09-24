export type AppRole = 'viewer' | 'editor' | 'admin';

export interface AppMember {
  user_id: string;
  role: AppRole;
  active: boolean;
}

export interface VolunteerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  recruited_year: number | null;
  programmes_registered: string[];
  tags: string[];
  shirt_size: string | null;
  notes: string | null;
  updated_at: string;
  row_version: number;
}

export interface VolunteerUpdate {
  name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  recruited_year: number | null;
  tags: string[];
  programmes_registered: string[];
  shirt_size: string | null;
  notes: string | null;
}

export interface VolunteerFilters {
  search: string;
  tag: string | null;
  recruitedYear: number | null;
  sort: 'name-asc' | 'name-desc' | 'newest' | 'oldest';
  page: number;
  pageSize: number;
}

export type VolunteerLeadStatus =
  | 'new'
  | 'reviewing'
  | 'contacted'
  | 'accepted'
  | 'converted'
  | 'not_selected'
  | 'withdrawn';

export interface VolunteerLead {
  id: string;
  source: 'formsg' | 'manual';
  source_form_id: string | null;
  source_submission_id: string | null;
  submitted_at: string | null;
  status: VolunteerLeadStatus;
  full_name: string;
  email: string | null;
  phone: string | null;
  interest_area: string | null;
  motivation: string | null;
  skills_experience: string | null;
  availability_notes: string | null;
  referral_source: string | null;
  staff_notes: string | null;
  converted_volunteer_id: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  row_version: number;
}

export interface LeadFilters {
  search: string;
  status: VolunteerLeadStatus | null;
  page: number;
  pageSize: number;
}
