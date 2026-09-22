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
