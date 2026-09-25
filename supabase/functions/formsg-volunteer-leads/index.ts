import formsgFactory from "https://esm.sh/@opengovsg/formsg-sdk@8.1.0?target=deno&bundle";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const EXPECTED_FORM_ID = "6ab08df24e9cff0f3ac1af45";
const POST_URI =
  "https://glpdougaxlgaipqlzcbq.supabase.co/functions/v1/formsg-volunteer-leads";

const formsg = formsgFactory({ mode: "production" });

type FormField = {
  question?: string;
  answer?: string;
  answerArray?: string[];
  fieldType?: string;
  _id?: string;
};

function clean(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function answerFor(field: FormField): string | null {
  if (typeof field.answer === "string") return clean(field.answer);
  if (Array.isArray(field.answerArray)) {
    return clean(field.answerArray.map((value) => value.trim()).filter(Boolean).join(", "));
  }
  return null;
}

function findAnswer(
  responses: FormField[],
  matcher: (question: string) => boolean,
): string | null {
  for (const field of responses) {
    const question = normalizeQuestion(field.question ?? "");
    if (!question || !matcher(question)) continue;
    const answer = answerFor(field);
    if (answer) return answer;
  }
  return null;
}

function mapLead(responses: FormField[]) {
  const fullName =
    findAnswer(
      responses,
      (q) =>
        q === "name" ||
        q.includes("full name") ||
        q.includes("name as in") ||
        q.includes("your name"),
    ) ??
    findAnswer(responses, (q) => q.includes("name"));

  return {
    fullName,
    email: findAnswer(
      responses,
      (q) => q === "email" || q.includes("email address") || q.includes("e mail"),
    ),
    phone: findAnswer(
      responses,
      (q) =>
        q.includes("mobile") ||
        q.includes("phone") ||
        q.includes("contact number") ||
        q.includes("contact no"),
    ),
    interestArea: findAnswer(
      responses,
      (q) =>
        q.includes("interest area") ||
        q.includes("area of interest") ||
        q.includes("volunteer role") ||
        q.includes("role interest") ||
        q.includes("which role") ||
        q.includes("which area") ||
        q.includes("how would you like to contribute"),
    ),
    motivation: findAnswer(
      responses,
      (q) =>
        q.includes("why would you like to volunteer") ||
        q.includes("why do you want to volunteer") ||
        q.includes("why are you interested in volunteering") ||
        q.includes("interested in volunteering") ||
        q.includes("motivation"),
    ),
    skillsExperience: findAnswer(
      responses,
      (q) =>
        q.includes("skills") ||
        q.includes("experience") ||
        q.includes("expertise"),
    ),
    availabilityNotes: findAnswer(
      responses,
      (q) =>
        q.includes("availability") ||
        q.includes("available to volunteer") ||
        q.includes("when are you available"),
    ),
    referralSource: findAnswer(
      responses,
      (q) =>
        q.includes("how did you hear") ||
        q.includes("referral source") ||
        q.includes("heard about"),
    ),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const signature = req.headers.get("X-FormSG-Signature");
  if (!signature) {
    return Response.json({ message: "Missing FormSG signature" }, { status: 401 });
  }

  try {
    formsg.webhooks.authenticate(signature, POST_URI);
  } catch {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const formSecretKey = Deno.env.get("FORMSG_VOLUNTEER_FORM_SECRET");
  if (!formSecretKey) {
    console.error("FORMSG_VOLUNTEER_FORM_SECRET is not configured");
    return Response.json({ message: "Webhook is not configured" }, { status: 503 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const data = payload?.data;
  const formId = clean(data?.formId);
  const submissionId = clean(data?.submissionId);
  const submittedAt = clean(data?.created);

  if (formId !== EXPECTED_FORM_ID) {
    return Response.json({ message: "Unexpected FormSG form" }, { status: 403 });
  }

  if (!submissionId || !data?.encryptedContent) {
    return Response.json({ message: "Incomplete FormSG submission" }, { status: 400 });
  }

  const decrypted = formsg.crypto.decrypt(formSecretKey, data);
  if (!decrypted) {
    return Response.json({ message: "Could not decrypt FormSG submission" }, { status: 422 });
  }

  const responses = Array.isArray(decrypted.responses)
    ? (decrypted.responses as FormField[])
    : [];
  const lead = mapLead(responses);

  if (!lead.fullName) {
    console.error("FormSG volunteer lead is missing a recognisable name field", {
      submissionId,
    });
    return Response.json(
      { message: "Volunteer name could not be mapped" },
      { status: 422 },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase function environment is incomplete");
    return Response.json({ message: "Webhook backend is unavailable" }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin
    .from("volunteer_leads")
    .upsert(
      {
        source: "formsg",
        source_form_id: EXPECTED_FORM_ID,
        source_submission_id: submissionId,
        submitted_at:
          submittedAt && !Number.isNaN(Date.parse(submittedAt))
            ? new Date(submittedAt).toISOString()
            : new Date().toISOString(),
        status: "new",
        full_name: lead.fullName,
        email: lead.email,
        phone: lead.phone,
        interest_area: lead.interestArea,
        motivation: lead.motivation,
        skills_experience: lead.skillsExperience,
        availability_notes: lead.availabilityNotes,
        referral_source: lead.referralSource,
        raw_payload: {
          formId,
          submissionId,
          created: submittedAt,
          verifiedContentPresent: Boolean(decrypted.verified),
        },
      },
      {
        onConflict: "source,source_form_id,source_submission_id",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    console.error("Unable to persist FormSG volunteer lead", {
      submissionId,
      code: error.code,
    });
    return Response.json({ message: "Could not store volunteer lead" }, { status: 500 });
  }

  return Response.json({ received: true, submissionId }, { status: 200 });
});
