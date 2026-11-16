"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PanelActionState } from "@/app/actions/panel";

/**
 * Disconnect MP account from a venue.
 * Checks for active holds and paid bookings that have not ended yet.
 * Resets deposit/payment settings first, then deletes the MP account.
 */
export async function disconnectMpAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const venueId = formData.get("venue_id") as string;
  if (!venueId) return { error: "Datos incompletos" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // Verify ownership
  const { data: venue } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!venue) return { error: "No autorizado" };

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Check for active holds (not yet expired)
  const { count: holdCount } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .eq("status", "hold")
    .gt("hold_expires_at", now);

  if (holdCount && holdCount > 0) {
    return { error: "Hay reservas en proceso de pago. Esperá unos minutos e intentá de nuevo." };
  }

  // Confirmed bookings paid online block the disconnect only while their
  // period has not ended yet. A paid booking that was already played does not.
  // Newest first, so a truncated result can never hide the future ones.
  const { data: paidBookings, error: paidError } = await admin
    .from("bookings")
    .select("id, period")
    .eq("venue_id", venueId)
    .eq("status", "confirmed")
    .in("payment_status", ["deposit_paid", "paid"])
    .order("period", { ascending: false });

  if (paidError) return { error: "Error al verificar pagos activos: " + paidError.message };

  const nowMs = Date.now();
  const hasFuturePaid = (paidBookings ?? []).some((b) => {
    // PostgREST returns tstzrange as: ["2026-11-12 11:00:00+00","2026-11-12 12:30:00+00")
    const raw = b.period as string;
    const upper = raw.slice(raw.indexOf(",") + 1).replace(/[\])"]/g, "").trim();
    const endMs = new Date(upper).getTime();
    // Unparseable end → treat as future (never disconnect on a doubt)
    return Number.isNaN(endMs) || endMs > nowMs;
  });

  if (hasFuturePaid) {
    return { error: "No podés desconectar con pagos activos. Esperá a que se completen o cancelen." };
  }

  // Reset venue payment settings FIRST so create_booking works without MP.
  // If this fails we return without touching mp_accounts: a venue must never
  // be left requiring a deposit with no MP account to collect it.
  const { error: resetError } = await admin
    .from("venues")
    .update({
      deposit_required:    false,
      allow_full_payment:  false,
      allow_pay_at_venue:  true,
    })
    .eq("id", venueId);

  if (resetError) return { error: "Error al desconectar: " + resetError.message };

  // Delete mp_accounts row.
  // MP does NOT have a grant_type "revoke" at /oauth/token: the official way
  // to disconnect is to stop using the tokens, so deleting them is enough.
  const { error: delError } = await admin
    .from("mp_accounts")
    .delete()
    .eq("venue_id", venueId);

  if (delError) return { error: "Error al desconectar: " + delError.message };

  // Audit log (best-effort — the disconnect already succeeded)
  const { error: auditErr } = await admin.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "mp_account",
    entity_id:  venueId,
    action:     "delete",
  });
  if (auditErr) {
    console.error("[mp] audit_log insert failed on disconnect:", auditErr.message);
  }

  revalidatePath(`/panel/complejos/${venueId}`);
  return null;
}
