"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { triggerPushSend } from "@/lib/push";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PanelActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// ---------------------------------------------------------------------------
// Venue actions
// ---------------------------------------------------------------------------

const VenueSchema = z.object({
  name:               z.string().min(2, "Mínimo 2 caracteres").max(80),
  phone:              z.string().min(8, "Mínimo 8 dígitos").max(15),
  address:            z.string().min(5, "Mínimo 5 caracteres").max(200),
  locality_id:        z.string().uuid("Seleccioná una localidad"),
  lat:                z.coerce.number().min(-90).max(90),
  lng:                z.coerce.number().min(-180).max(180),
  payment_alias:      z.string().max(100).optional(),
  payment_link:       z.string().max(500).optional(),
  whatsapp_template:  z.string().max(500).optional(),
});

export async function createVenueAction(
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const raw = Object.fromEntries(formData);
  const parsed = VenueSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { name, phone, address, locality_id, lat, lng, payment_alias, payment_link, whatsapp_template } = parsed.data;

  const { data: venue, error } = await supabase
    .from("venues")
    .insert({
      owner_id:           user.id,
      name,
      phone:              phone.replace(/\D/g, ""),
      address,
      locality_id,
      lat,
      lng,
      payment_alias:      payment_alias      || null,
      payment_link:       payment_link       || null,
      whatsapp_template:  whatsapp_template  || null,
      status:             "pending",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venue.id,
    entity:     "venue",
    entity_id:  venue.id,
    action:     "create",
    new_data:   parsed.data,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath("/panel/complejos");
  redirect("/panel/complejos");
}

export async function updateVenueAction(
  venueId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const raw = Object.fromEntries(formData);
  const parsed = VenueSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { name, phone, address, locality_id, lat, lng, payment_alias, payment_link, whatsapp_template } = parsed.data;

  const { error } = await supabase
    .from("venues")
    .update({
      name,
      phone:              phone.replace(/\D/g, ""),
      address,
      locality_id,
      lat,
      lng,
      payment_alias:      payment_alias      || null,
      payment_link:       payment_link       || null,
      whatsapp_template:  whatsapp_template  || null,
    })
    .eq("id", venueId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update",
    new_data:   parsed.data,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}`);
  revalidatePath("/panel/complejos");
  redirect("/panel/complejos");
}

// ---------------------------------------------------------------------------
// Court actions
// ---------------------------------------------------------------------------

const CourtSchema = z.object({
  name:         z.string().min(1, "Requerido").max(60),
  sport_id:     z.string().uuid("Seleccioná un deporte"),
  slot_minutes: z.coerce.number().min(30).max(240),
  active:       z.coerce.boolean().default(true),
});

export async function createCourtAction(
  venueId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const raw = {
    name:         formData.get("name"),
    sport_id:     formData.get("sport_id"),
    slot_minutes: formData.get("slot_minutes"),
    active:       formData.get("active") !== null,
  };
  const parsed = CourtSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { data: court, error } = await supabase
    .from("courts")
    .insert({
      venue_id:     venueId,
      name:         parsed.data.name,
      sport_id:     parsed.data.sport_id,
      slot_minutes: parsed.data.slot_minutes,
      active:       parsed.data.active,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Horarios precargados según deporte (SPEC §12)
  const { data: sport } = await supabase
    .from("sports")
    .select("slug")
    .eq("id", parsed.data.sport_id)
    .single();

  const SPORT_HOURS: Record<string, { open: string; close: string }> = {
    padel:  { open: "08:00:00", close: "00:30:00" },
    futbol: { open: "14:00:00", close: "00:00:00" },
    tenis:  { open: "08:00:00", close: "23:00:00" },
  };
  const h = SPORT_HOURS[sport?.slug ?? ""] ?? { open: "08:00:00", close: "22:00:00" };

  const defaultHours = Array.from({ length: 7 }, (_, weekday) => ({
    court_id:   court.id,
    weekday,
    open_time:  h.open,
    close_time: h.close,
  }));
  await supabase.from("court_hours").insert(defaultHours);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "court",
    entity_id:  court.id,
    action:     "create",
    new_data:   parsed.data,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/canchas`);
  redirect(`/panel/complejos/${venueId}/canchas/${court.id}`);
}

export async function updateCourtAction(
  venueId: string,
  courtId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const raw = {
    name:         formData.get("name"),
    sport_id:     formData.get("sport_id"),
    slot_minutes: formData.get("slot_minutes"),
    active:       formData.get("active") !== null,
  };
  const parsed = CourtSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { error } = await supabase
    .from("courts")
    .update({
      name:         parsed.data.name,
      sport_id:     parsed.data.sport_id,
      slot_minutes: parsed.data.slot_minutes,
      active:       parsed.data.active,
    })
    .eq("id", courtId)
    .eq("venue_id", venueId);

  if (error) return { error: error.message };

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "court",
    entity_id:  courtId,
    action:     "update",
    new_data:   parsed.data,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/canchas/${courtId}`);
  return null;
}

// ---------------------------------------------------------------------------
// Court hours
// ---------------------------------------------------------------------------

const HoursSchema = z.array(
  z.object({
    weekday:    z.coerce.number().min(0).max(6),
    open_time:  z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    close_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  })
);

export async function saveCourtHoursAction(
  venueId: string,
  courtId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  let rows: unknown[];
  try {
    rows = JSON.parse(formData.get("hours") as string);
  } catch {
    return { error: "Datos inválidos" };
  }

  const parsed = HoursSchema.safeParse(rows);
  if (!parsed.success) return { error: "Formato de horarios inválido" };

  // Normalize time to HH:MM:SS
  const hours = parsed.data.map((h) => ({
    court_id:   courtId,
    weekday:    h.weekday,
    open_time:  h.open_time.length === 5 ? `${h.open_time}:00` : h.open_time,
    close_time: h.close_time.length === 5 ? `${h.close_time}:00` : h.close_time,
  }));

  // Replace all hours for this court
  const { error: delErr } = await supabase.from("court_hours").delete().eq("court_id", courtId);
  if (delErr) return { error: delErr.message };

  if (hours.length > 0) {
    const { error: insErr } = await supabase.from("court_hours").insert(hours);
    if (insErr) return { error: insErr.message };
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "court_hours",
    entity_id:  courtId,
    action:     "update",
    new_data:   hours,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/canchas/${courtId}`);
  return null;
}

// ---------------------------------------------------------------------------
// Court prices
// ---------------------------------------------------------------------------

const PricesSchema = z.array(
  z.object({
    weekday:   z.coerce.number().min(0).max(6),
    from_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    to_time:   z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    price:     z.coerce.number().min(0),
  })
);

export async function saveCourtPricesAction(
  venueId: string,
  courtId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  let rows: unknown[];
  try {
    rows = JSON.parse(formData.get("prices") as string);
  } catch {
    return { error: "Datos inválidos" };
  }

  const parsed = PricesSchema.safeParse(rows);
  if (!parsed.success) return { error: "Formato de precios inválido" };

  const prices = parsed.data.map((p) => ({
    court_id:  courtId,
    weekday:   p.weekday,
    from_time: p.from_time.length === 5 ? `${p.from_time}:00` : p.from_time,
    to_time:   p.to_time.length === 5   ? `${p.to_time}:00`   : p.to_time,
    price:     p.price,
  }));

  const { error: delErr } = await supabase.from("court_prices").delete().eq("court_id", courtId);
  if (delErr) return { error: delErr.message };

  if (prices.length > 0) {
    const { error: insErr } = await supabase.from("court_prices").insert(prices);
    if (insErr) return { error: insErr.message };
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "court_prices",
    entity_id:  courtId,
    action:     "update",
    new_data:   prices,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/canchas/${courtId}`);
  return null;
}

// ---------------------------------------------------------------------------
// Agenda: booking management actions
// ---------------------------------------------------------------------------

/** Verifica que la reserva pertenece a un complejo del usuario autenticado */
async function assertOwnsBooking(supabase: Awaited<ReturnType<typeof createClient>>, bookingId: string, venueId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: b } = await supabase
    .from("bookings")
    .select("id")
    .eq("id", bookingId)
    .eq("venue_id", venueId)
    .single();
  const { data: v } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  return !!(b && v);
}

export async function cancelBookingPanelAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const bookingId = formData.get("booking_id") as string;
  const venueId   = formData.get("venue_id")   as string;
  const date      = formData.get("date")        as string;
  if (!bookingId || !venueId) return { error: "Datos incompletos" };

  const supabase = await createClient();
  const owns = await assertOwnsBooking(supabase, bookingId, venueId);
  if (!owns) return { error: "No autorizado" };

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);
  if (error) return { error: error.message };

  const { data: { user: cancelUser } } = await supabase.auth.getUser();
  const { error: cancelAuditErr } = await supabase.from("audit_log").insert({
    profile_id: cancelUser!.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  bookingId,
    action:     "cancel",
  });
  if (cancelAuditErr) return { error: "Error en auditoría: " + cancelAuditErr.message };

  // Notificación outbox para el dueño (best-effort: no bloquea si falla)
  const { data: bk } = await supabase
    .from("bookings")
    .select("customer_name, customer_phone, period")
    .eq("id", bookingId)
    .single();
  if (bk) {
    await supabase.from("notification_outbox").insert({
      venue_id: venueId,
      type:     "booking_cancelled",
      payload:  {
        booking_id:     bookingId,
        customer_name:  bk.customer_name,
        customer_phone: bk.customer_phone,
        start:          (bk.period as string).replace(/[\[(]/, "").split(",")[0].trim().replace(/"/g, ""),
      },
    });
    void triggerPushSend();
  }

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

export async function markPaidAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const bookingId  = formData.get("booking_id")  as string;
  const venueId    = formData.get("venue_id")    as string;
  const date       = formData.get("date")         as string;
  const priceTotal = Number(formData.get("price_total") ?? 0);
  if (!bookingId || !venueId) return { error: "Datos incompletos" };

  const supabase = await createClient();
  const owns = await assertOwnsBooking(supabase, bookingId, venueId);
  if (!owns) return { error: "No autorizado" };

  const { error } = await supabase
    .from("bookings")
    .update({ payment_status: "paid", amount_paid: priceTotal })
    .eq("id", bookingId);
  if (error) return { error: error.message };

  const { data: { user: paidUser } } = await supabase.auth.getUser();
  const { error: paidAuditErr } = await supabase.from("audit_log").insert({
    profile_id: paidUser!.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  bookingId,
    action:     "mark_paid",
    new_data:   { price_total: priceTotal },
  });
  if (paidAuditErr) return { error: "Error en auditoría: " + paidAuditErr.message };

  // Notificación outbox para el dueño (best-effort)
  const { data: paidBk } = await supabase
    .from("bookings")
    .select("customer_name, customer_phone, period")
    .eq("id", bookingId)
    .single();
  if (paidBk) {
    await supabase.from("notification_outbox").insert({
      venue_id: venueId,
      type:     "payment_received",
      payload:  {
        booking_id:     bookingId,
        customer_name:  paidBk.customer_name,
        customer_phone: paidBk.customer_phone,
        start:          (paidBk.period as string).replace(/[\[(]/, "").split(",")[0].trim().replace(/"/g, ""),
        price_total:    priceTotal,
      },
    });
    void triggerPushSend();
  }

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

export async function markNoShowAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const bookingId = formData.get("booking_id") as string;
  const venueId   = formData.get("venue_id")   as string;
  const date      = formData.get("date")        as string;
  if (!bookingId || !venueId) return { error: "Datos incompletos" };

  const supabase = await createClient();
  const owns = await assertOwnsBooking(supabase, bookingId, venueId);
  if (!owns) return { error: "No autorizado" };

  const { error } = await supabase
    .from("bookings")
    .update({ status: "no_show" })
    .eq("id", bookingId);
  if (error) return { error: error.message };

  const { data: { user: noShowUser } } = await supabase.auth.getUser();
  const { error: noShowAuditErr } = await supabase.from("audit_log").insert({
    profile_id: noShowUser!.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  bookingId,
    action:     "mark_no_show",
  });
  if (noShowAuditErr) return { error: "Error en auditoría: " + noShowAuditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

export async function blockPhonePanelAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const phone   = formData.get("phone")    as string;
  const venueId = formData.get("venue_id") as string;
  const date    = formData.get("date")     as string;
  if (!phone || !venueId) return { error: "Datos incompletos" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: v } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!v) return { error: "No autorizado" };

  const normalizedPhone = phone.replace(/\D/g, "");
  if (normalizedPhone.length < 7) return { error: "Teléfono inválido" };

  const { error } = await supabase
    .from("blocked_phones")
    .upsert({ venue_id: venueId, phone: normalizedPhone }, { onConflict: "venue_id,phone" });
  if (error) return { error: error.message };

  const { error: blockAuditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "blocked_phone",
    entity_id:  venueId,
    action:     "create",
    new_data:   { phone: normalizedPhone },
  });
  if (blockAuditErr) return { error: "Error en auditoría: " + blockAuditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

export async function createManualBlockAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const venueId = formData.get("venue_id") as string;
  const courtId = formData.get("court_id") as string;
  const start   = formData.get("start")    as string; // "YYYY-MM-DDTHH:MM" Mendoza
  const end     = formData.get("end")      as string;
  const note    = (formData.get("note") as string | null)?.trim() || "Bloqueo";
  const date    = formData.get("date")     as string;

  if (!venueId || !courtId || !start || !end) return { error: "Datos incompletos" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: v } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!v) return { error: "No autorizado" };

  // start/end are "YYYY-MM-DDTHH:MM" in Mendoza time (UTC-3)
  const startUtc = new Date(start + ":00-03:00").toISOString();
  const endUtc   = new Date(end   + ":00-03:00").toISOString();

  if (new Date(startUtc) >= new Date(endUtc)) return { error: "El inicio debe ser antes que el fin" };

  const { data: blockData, error } = await supabase.from("bookings").insert({
    court_id:       courtId,
    venue_id:       venueId,
    period:         `[${startUtc},${endUtc})`,
    status:         "confirmed",
    kind:           "block",
    customer_name:  note,
    customer_phone: null,
    price_total:    0,
    amount_paid:    0,
    payment_status: "unpaid",
    cancel_token:   crypto.randomUUID(),
  }).select("id").single();
  if (error) return { error: error.message };

  const { error: blockCreateAuditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  blockData!.id,
    action:     "create_block",
    new_data:   { court_id: courtId, start: startUtc, end: endUtc, note },
  });
  if (blockCreateAuditErr) return { error: "Error en auditoría: " + blockCreateAuditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

// ---------------------------------------------------------------------------
// Blocked phones: unblock
// ---------------------------------------------------------------------------

export async function unblockPhoneAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const phone   = formData.get("phone")    as string;
  const venueId = formData.get("venue_id") as string;
  if (!phone || !venueId) return { error: "Datos incompletos" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: v } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!v) return { error: "No autorizado" };

  const { error } = await supabase
    .from("blocked_phones")
    .delete()
    .eq("venue_id", venueId)
    .eq("phone", phone);
  if (error) return { error: error.message };

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "blocked_phone",
    entity_id:  venueId,
    action:     "delete",
    new_data:   { phone },
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}/bloqueados`);
  return null;
}
