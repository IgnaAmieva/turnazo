"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refundPayment } from "@/lib/mp/refunds";
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
// Venue payment settings (seña, pago total, pago en el lugar)
// ---------------------------------------------------------------------------

export async function updatePaymentSettingsAction(
  venueId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: venue } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!venue) return { error: "No autorizado" };

  // Checkboxes: present in the form data = checked.
  const depositRequired  = formData.get("deposit_required")   !== null;
  const allowFullPayment = formData.get("allow_full_payment") !== null;
  // Seña obligatoria implica que no hay pago en el lugar, mande lo que mande el form.
  const allowPayAtVenue  = depositRequired ? false : formData.get("allow_pay_at_venue") !== null;

  let depositType: "fixed" | "percent" | null = null;
  let depositValue: number | null = null;

  if (depositRequired) {
    const rawType = formData.get("deposit_type");
    if (rawType !== "fixed" && rawType !== "percent") {
      return { fieldErrors: { deposit_type: ["Elegí seña fija o por porcentaje"] } };
    }
    depositType = rawType;

    // deposit_value is numeric(10,2): validate what will actually be stored.
    const rawValue = String(formData.get("deposit_value") ?? "").trim();
    const value    = rawValue === "" ? NaN : Math.round(Number(rawValue) * 100) / 100;

    if (depositType === "percent" && !(value >= 1 && value <= 100)) {
      return { fieldErrors: { deposit_value: ["El porcentaje de seña debe estar entre 1 y 100"] } };
    }
    if (depositType === "fixed" && !(value > 0 && value <= 99_999_999)) {
      return { fieldErrors: { deposit_value: ["El monto de la seña debe ser mayor a 0"] } };
    }
    depositValue = value;
  }

  if (!depositRequired && !allowFullPayment && !allowPayAtVenue) {
    return { error: "Dejá al menos una forma de pago activa." };
  }

  // Seña y pago total se cobran por Mercado Pago: sin cuenta conectada no se activan.
  if (depositRequired || allowFullPayment) {
    const { data: mpAccount, error: mpError } = await supabase
      .from("mp_accounts")
      .select("id")
      .eq("venue_id", venueId)
      .maybeSingle();
    if (mpError) return { error: "No se pudo verificar Mercado Pago: " + mpError.message };
    if (!mpAccount) {
      return { error: "Conectá Mercado Pago para activar la seña o el pago total." };
    }
  }

  const settings = {
    deposit_required:   depositRequired,
    deposit_type:       depositType,
    deposit_value:      depositValue,
    allow_full_payment: allowFullPayment,
    allow_pay_at_venue: allowPayAtVenue,
  };

  const { error } = await supabase
    .from("venues")
    .update(settings)
    .eq("id", venueId)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update_payment_settings",
    new_data:   settings,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Venue cancellation policy (cancel_limit_hours, refund_policy)
// ---------------------------------------------------------------------------

const CancellationPolicySchema = z.object({
  cancel_limit_hours: z.coerce.number().int("Tiene que ser un número entero de horas")
    .min(0, "Mínimo 0 horas").max(168, "Máximo 168 horas (7 días)"),
  refund_policy: z.enum(["full", "none"], { message: "Elegí qué pasa con lo pagado online" }),
});

export async function updateCancellationPolicyAction(
  venueId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: venue } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!venue) return { error: "No autorizado" };

  const parsed = CancellationPolicySchema.safeParse({
    cancel_limit_hours: formData.get("cancel_limit_hours"),
    refund_policy:      formData.get("refund_policy"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { error } = await supabase
    .from("venues")
    .update(parsed.data)
    .eq("id", venueId)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update_cancellation_policy",
    new_data:   parsed.data,
  });
  if (auditErr) return { error: "Error en auditoría: " + auditErr.message };

  revalidatePath(`/panel/complejos/${venueId}`);
  return {};
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

  // Pago online acreditado (si lo hay): cuando cancela el complejo se devuelve
  // siempre, sin importar el plazo ni la política de devoluciones.
  const { data: onlinePay } = await supabase
    .from("payments")
    .select("mp_order_id, mp_payment_id, amount, type")
    .eq("booking_id", bookingId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const refundDue = !!onlinePay && Number(onlinePay.amount) > 0 && !!onlinePay.mp_order_id;

  // Solo se cancela una reserva confirmada: así dos clicks (o dos pestañas)
  // no disparan dos devoluciones.
  const { data: cancelled, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("status", "confirmed")
    .select("customer_name, customer_phone, period, amount_paid");
  if (error) return { error: error.message };
  const bk = cancelled?.[0];
  if (!bk) return { error: "La reserva ya no está confirmada" };

  // Devolución (misma función idempotente que el webhook y el jugador). Antes
  // se marca el pago 'refund_pending' para que, si esto se cae, el cron lo tome.
  let refundStatus: "none" | "refunded" | "pending" = "none";
  if (refundDue && onlinePay) {
    const admin = createAdminClient();
    const { data: payRow } = await admin
      .from("payments").select("raw").eq("mp_payment_id", onlinePay.mp_payment_id).maybeSingle();
    const prevRaw = (payRow?.raw && typeof payRow.raw === "object" && !Array.isArray(payRow.raw) ? payRow.raw : {}) as Record<string, unknown>;
    await admin
      .from("payments")
      .update({ status: "refund_pending", raw: { ...prevRaw, reason: "owner_cancelled" } as never })
      .eq("mp_payment_id", onlinePay.mp_payment_id)
      .eq("status", "approved");
    const refund = await refundPayment(admin, {
      bookingId,
      venueId,
      orderId:     onlinePay.mp_order_id!,
      paymentId:   onlinePay.mp_payment_id,
      amount:      Number(onlinePay.amount),
      paymentType: onlinePay.type === "full" ? "full" : "deposit",
      reason:      "owner_cancelled",
      source:      "owner_cancel",
      markBookingRefunded: true,
    });
    refundStatus = refund.ok ? "refunded" : "pending";
  }

  const { data: { user: cancelUser } } = await supabase.auth.getUser();
  const { error: cancelAuditErr } = await supabase.from("audit_log").insert({
    profile_id: cancelUser!.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  bookingId,
    action:     "cancel",
    new_data:   {
      refund:        refundStatus,
      refund_amount: refundDue && onlinePay ? Number(onlinePay.amount) : 0,
      ...(refundDue && onlinePay ? { mp_payment_id: onlinePay.mp_payment_id } : {}),
    },
  });
  if (cancelAuditErr) return { error: "Error en auditoría: " + cancelAuditErr.message };

  // Notificación outbox para el dueño (best-effort: no bloquea si falla)
  await supabase.from("notification_outbox").insert({
    venue_id: venueId,
    type:     "booking_cancelled",
    payload:  {
      booking_id:     bookingId,
      customer_name:  bk.customer_name,
      customer_phone: bk.customer_phone,
      start:          (bk.period as string).replace(/[\[(]/, "").split(",")[0].trim().replace(/"/g, ""),
      cancelled_by:   "owner",
      amount_paid:    bk.amount_paid,
      refund_due:     refundDue,
      refund_amount:  refundDue && onlinePay ? Number(onlinePay.amount) : 0,
      refund_status:  refundStatus,
    },
  });
  void triggerPushSend();

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
