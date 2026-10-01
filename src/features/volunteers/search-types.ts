import type { VolunteerRow } from '../../lib/types';

export type VolunteerQueryGroupOperator='AND'|'OR';
export type VolunteerQueryValue=string|string[];

export interface VolunteerQueryCondition {
  id:string;
  type:'condition';
  field:string;
  operator:string;
  value:VolunteerQueryValue;
}

export interface VolunteerQueryGroup {
  id:string;
  type:'group';
  operator:VolunteerQueryGroupOperator;
  children:VolunteerQueryNode[];
}

export type VolunteerQueryNode=VolunteerQueryCondition|VolunteerQueryGroup;

export interface VolunteerSearchOptions {
  tags:string[];
  programmes:string[];
  genders:string[];
  shirtSizes:string[];
  planningAreas:string[];
  electoralDivisions:string[];
  events:string[];
}

export type VolunteerSearchSort=
  |'name-asc'|'name-desc'|'newest'|'oldest'|'hours'|'last-active'|'tag'
  |'events-attended'|'events-registered'|'recruited-year';

export interface VolunteerSearchFilters {
  search:string;
  query:VolunteerQueryGroup;
  sort:VolunteerSearchSort;
  page:number;
  pageSize:number;
}

export interface VolunteerSearchResult {
  rows:VolunteerRow[];
  count:number;
  page:number;
  pageSize:number;
}

export function createEmptyVolunteerQuery():VolunteerQueryGroup {
  return {id:'root',type:'group',operator:'AND',children:[]};
}
