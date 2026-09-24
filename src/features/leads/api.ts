import { supabase } from '../../lib/supabase';
import type { LeadFilters, VolunteerLead, VolunteerLeadStatus } from '../../lib/types';

function safeSearchTerm(value: string) {
  return value.trim().replace(/[,%()]/g, ' ');
}

export async function fetchVolunteerLeads(filters: LeadFilters) {
  const from = filters.page * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let query = supabase
    .from('volunteer_leads')
    .select(
      'id,source,source_form_id,source_submission_id,submitted_at,status,full_name,email,phone,interest_area,motivation,skills_experience,availability_notes,referral_source,staff_notes,converted_volunteer_id,converted_at,created_at,updated_at,row_version',
      { count: 'exact' },
    );

  const search = safeSearchTerm(filters.search);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or([
      `full_name.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      `phone.ilike.${pattern}`,
      `interest_area.ilike.${pattern}`,
      `staff_notes.ilike.${pattern}`,
    ].join(','));
  }

  if (filters.status) query = query.eq('status', filters.status);

  query = query.order('submitted_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  return {
    rows: (data || []) as VolunteerLead[],
    count: count || 0,
  };
}

export async function updateVolunteerLead(
  id: string,
  expectedVersion: number,
  update: { status: VolunteerLeadStatus; staff_notes: string | null },
): Promise<VolunteerLead> {
  const { data, error } = await supabase
    .from('volunteer_leads')
    .update(update)
    .eq('id', id)
    .eq('row_version', expectedVersion)
    .select(
      'id,source,source_form_id,source_submission_id,submitted_at,status,full_name,email,phone,interest_area,motivation,skills_experience,availability_notes,referral_source,staff_notes,converted_volunteer_id,converted_at,created_at,updated_at,row_version',
    )
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('This lead was updated in another session. Reload before saving again.');
  }
  return data as VolunteerLead;
}

export async function convertVolunteerLead(id: string) {
  const { data, error } = await supabase.rpc('maklom_convert_volunteer_lead', {
    p_lead_id: id,
  });
  if (error) throw error;
  return data as { status: string; lead_id: string; volunteer_id: string };
}

export async function importFormSgLeads(rows: Array<Record<string, string>>) {
  const normalized = rows.map((row) => {
    const entries = Object.entries(row);
    const find = (...needles: string[]) => {
      const hit = entries.find(([key]) => {
        const lower = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        return needles.some((needle) => lower.includes(needle));
      });
      return hit?.[1]?.trim() || null;
    };

    const fullName = find('fullname', 'name');
    if (!fullName) return null;

    const submittedAtRaw = find('submittedat', 'submissiontime', 'timestamp', 'createdat');
    const submittedAt = submittedAtRaw && !Number.isNaN(Date.parse(submittedAtRaw))
      ? new Date(submittedAtRaw).toISOString()
      : new Date().toISOString();

    const submissionId =
      find('responseid', 'submissionid', 'response') ||
      crypto.randomUUID();

    return {
      source: 'formsg',
      source_form_id: '6ab08df24e9cff0f3ac1af45',
      source_submission_id: submissionId,
      submitted_at: submittedAt,
      status: 'new',
      full_name: fullName,
      email: find('email'),
      phone: find('mobilenumber', 'contactnumber', 'phonenumber', 'mobile', 'phone'),
      interest_area: find('interest', 'volunteerrole', 'role'),
      motivation: find('motivation', 'whywouldyouliketovolunteer'),
      skills_experience: find('skillsexperience', 'skills', 'experience'),
      availability_notes: find('availability'),
      referral_source: find('howdidyouhear', 'referralsource'),
      raw_payload: row,
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  if (!normalized.length) {
    throw new Error('No rows with a recognisable name field were found.');
  }

  const { error } = await supabase
    .from('volunteer_leads')
    .upsert(normalized, {
      onConflict: 'source,source_form_id,source_submission_id',
      ignoreDuplicates: true,
    });

  if (error) throw error;
  return normalized.length;
}
