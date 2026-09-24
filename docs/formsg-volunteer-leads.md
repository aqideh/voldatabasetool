# FormSG volunteer lead webhook

MakLom receives prospective-volunteer submissions from the KELUARGA MENDAKI FormSG form through a signed FormSG webhook.

## Production endpoint

`https://glpdougaxlgaipqlzcbq.supabase.co/functions/v1/formsg-volunteer-leads`

Expected FormSG form ID: `6ab08df24e9cff0f3ac1af45`.

## Security

- The function is intentionally public at the Supabase gateway because FormSG does not send Supabase authentication.
- Every request must contain a valid `X-FormSG-Signature` verified with the official FormSG SDK.
- The signature is bound to the exact production webhook URL.
- Requests from any other FormSG form ID are rejected.
- Storage Mode submissions are decrypted only inside the server-side Edge Function.
- The FormSG form secret must be stored as the Supabase Edge Function secret `FORMSG_VOLUNTEER_FORM_SECRET`; it must never be committed.
- Duplicate FormSG retries are idempotent because `source + source_form_id + source_submission_id` is unique.

## Data flow

FormSG submission -> signed webhook -> server-side decryption -> field mapping -> `public.volunteer_leads`.

A FormSG submission creates a lead with status `new`. It does not create a canonical volunteer. Staff review the lead in MakLom and explicitly accept/convert it.

The webhook stores mapped operational lead fields and minimal source metadata. It deliberately does not retain the complete decrypted FormSG response in `raw_payload`.

## FormSG setup

In the FormSG form settings, configure webhook mode using the production endpoint above. Use the exact URL because FormSG signs the URI.

The form owner must retain the FormSG Storage Mode secret and configure its value in Supabase as `FORMSG_VOLUNTEER_FORM_SECRET`.

After setup, submit one controlled test response and confirm:
1. FormSG reports a successful webhook delivery.
2. MakLom -> Volunteer Leads shows one new lead.
3. Replaying/retrying the same submission does not create a duplicate.
4. The mapped name, email, mobile and interest fields match the FormSG answers.

Reference: FormSG Webhooks user guide and `@opengovsg/formsg-sdk`.
