import { supabase } from "./supabase";

/**
 * Find or create `clients` row by normalized phone (≥5 digits). Returns null if phone unusable.
 */
export async function resolveClientIdForVisit(
  clientName: string,
  clientPhone: string | null | undefined
): Promise<string | null> {
  const name = clientName.trim();
  if (!name) return null;
  const digits = String(clientPhone ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;

  const { data: existing, error: findErr } = await supabase
    .from("clients")
    .select("id")
    .eq("phone", digits)
    .maybeSingle();
  if (findErr) return null;

  if (existing?.id) {
    await supabase.from("clients").update({ name }).eq("id", existing.id);
    return existing.id as string;
  }

  const { data: ins, error: insErr } = await supabase
    .from("clients")
    .insert({ name, phone: digits })
    .select("id")
    .single();
  if (insErr || !ins?.id) return null;
  return ins.id as string;
}

/** @deprecated Prefer `resolveClientIdForVisit` + insert `appointments.client_id` in one step. */
export async function linkClientToAppointment(params: {
  appointmentId: string;
  clientName: string;
  clientPhone: string | null | undefined;
}): Promise<void> {
  const clientId = await resolveClientIdForVisit(params.clientName, params.clientPhone);
  if (!clientId) return;
  await supabase.from("appointments").update({ client_id: clientId }).eq("id", params.appointmentId);
}
