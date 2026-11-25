"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refundPayment } from "@/lib/mp/refunds";
import { triggerPushSend } from "@/lib/push";
import { detectLogoType, LOGO_BUCKET, LOGO_UPLOAD_MAX_BYTES } from "@/lib/venue-logo";
import { shrinkLogo } from "@/lib/venue-logo-shrink";
import { resolveLocality, type ResolvedLocality } from "@/lib/locality-resolver";
import { FORMAT_VALUES } from "@/lib/court-format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PanelActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// ---------------------------------------------------------------------------
// Errores: el detalle de Postgres/Supabase va al log del servidor, nunca al
// usuario (nombres de tablas, columnas y restricciones).
// ---------------------------------------------------------------------------

type DbError = { code?: string; message: string };

const GENERIC_ERROR = "No se pudo guardar. Intentá de nuevo.";

function dbError(err: DbError): PanelActionState {
  console.error("[panel] db error:", err.code ?? "", err.message);
  return { error: GENERIC_ERROR };
}

function auditError(err: DbError): PanelActionState {
  console.error("[panel] audit_log insert failed:", err.code ?? "", err.message);
  return { error: "No se pudo registrar el cambio. Intentá de nuevo." };
}

/** Códigos que devuelven los RPCs panel_* (migración 021). */
const PANEL_RPC_MESSAGES: Record<string, string> = {
  not_authenticated:    "No autenticado",
  not_owner:            "No autorizado",
  court_not_in_venue:   "Esa cancha no es de este complejo.",
  invalid_period:       "El inicio debe ser antes que el fin",
  past_period:          "El bloqueo tiene que terminar en el futuro.",
  period_too_long:      "Un bloqueo puede durar como máximo 7 días.",
  invalid_note:         "La nota puede tener hasta 80 caracteres.",
  slot_taken:           "Ese horario ya está ocupado.",
  not_confirmed:        "La reserva ya no está confirmada",
  already_paid:         "La reserva ya está paga.",
  no_show_before_start:
    "Una reserva pagada online solo se puede marcar como ausente después de su horario. " +
    "Para liberar el turno antes, cancelala: se le devuelve lo pagado.",
  // panel_create_booking (026): los códigos de _validate_booking_slot, dichos para el dueño
  past_slot:            "Ese horario ya pasó.",
  too_far_ahead:        "Se pueden cargar turnos hasta 30 días adelante.",
  invalid_slot:         "Ese horario no coincide con los turnos de la cancha.",
  invalid_duration:     "Ese horario no coincide con los turnos de la cancha.",
  outside_hours:        "Ese horario está fuera del horario de la cancha.",
  invalid_name:         "Escribí el nombre del jugador.",
  invalid_phone:        "Revisá el celular: código de área y número, sin 0 ni 15. Ej: 2622 123456.",
  phone_blocked:        "Ese número está bloqueado en tu complejo.",
  too_many_bookings:    "Ese celular ya tiene 3 turnos por jugar en tu complejo.",
  venue_not_found:      "Tu complejo todavía no está aprobado.",
  court_not_found:      "Esa cancha no está activa.",
  price_not_set:        "Ese horario no tiene precio. Cargalo en los precios de la cancha.",
};

/** Llama a un RPC panel_* con la sesión del dueño y traduce el resultado. */
async function callPanelRpc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fn: "panel_create_block" | "panel_create_booking" | "panel_cancel_booking" | "panel_mark_paid" | "panel_mark_no_show",
  args: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; state: PanelActionState }> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, state: dbError(error) };
  const res = (data ?? {}) as Record<string, unknown>;
  if (res.error) {
    const code = String(res.error);
    return { ok: false, state: { error: PANEL_RPC_MESSAGES[code] ?? GENERIC_ERROR } };
  }
  return { ok: true, data: res };
}

/** booking_id + venue_id de las acciones de agenda */
const BookingRefSchema = z.object({
  booking_id: z.string().guid(),
  venue_id:   z.string().guid(),
});

// ---------------------------------------------------------------------------
// Venue actions
// ---------------------------------------------------------------------------

const PIN_MISSING = "Marcá en el mapa dónde está el complejo.";
const LOCALITY_ERROR = "No pudimos ubicar el complejo. Intentá de nuevo.";

/** lat/lng del pin: obligatorios (sin pin, los campos llegan vacíos y no valen 0). */
const coord = (min: number, max: number) =>
  z.string().trim().min(1, PIN_MISSING).transform(Number).pipe(z.number({ error: PIN_MISSING }).min(min, PIN_MISSING).max(max, PIN_MISSING));

// La localidad NO viene del formulario: sale del pin en el servidor (lib/locality-resolver).
const VenueSchema = z.object({
  name:               z.string().min(2, "Mínimo 2 caracteres").max(80),
  phone:              z.string().min(8, "Mínimo 8 dígitos").max(15),
  address:            z.string().min(5, "Mínimo 5 caracteres").max(200),
  lat:                coord(-90, 90),
  lng:                coord(-180, 180),
  payment_alias:      z.string().max(100).optional(),
  payment_link:       z.string().max(500).optional(),
  whatsapp_template:  z.string().max(500).optional(),
});

/** Auditoría de una localidad creada por Georef al guardar un complejo. */
async function auditCreatedLocality(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string, venueId: string, loc: ResolvedLocality, pin: { lat: number; lng: number },
) {
  if (!loc.created) return null;
  const { error } = await supabase.from("audit_log").insert({
    profile_id: userId,
    venue_id:   venueId,
    entity:     "locality",
    entity_id:  loc.id,
    action:     "create",
    new_data:   { name: loc.name, source: loc.source, pin },
  });
  return error;
}

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

  const { name, phone, address, lat, lng, payment_alias, payment_link, whatsapp_template } = parsed.data;

  let loc: ResolvedLocality | null;
  try {
    loc = await resolveLocality({ lat, lng });
  } catch (e) {
    console.error("[panel] locality resolve failed:", (e as Error).message);
    loc = null;
  }
  if (!loc) return { error: LOCALITY_ERROR };
  const locality_id = loc.id;

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
      // status lo fija la base: siempre 'pending' (trigger trg_venues_status, 021)
    })
    .select("id")
    .single();

  if (error) return dbError(error);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venue.id,
    entity:     "venue",
    entity_id:  venue.id,
    action:     "create",
    // locality_source 'fallback' = Georef no respondió: el superadmin revisa la localidad al aprobar
    new_data:   { ...parsed.data, locality_id, locality_source: loc.source },
  });
  if (auditErr) return auditError(auditErr);
  const locAuditErr = await auditCreatedLocality(supabase, user.id, venue.id, loc, { lat, lng });
  if (locAuditErr) return auditError(locAuditErr);

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

  const { name, phone, address, lat, lng, payment_alias, payment_link, whatsapp_template } = parsed.data;

  const { data: current } = await supabase
    .from("venues")
    .select("lat, lng, locality_id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!current) return { error: "No autorizado" };

  // Con el pin en el mismo lugar, la localidad no se toca; si se movió, se vuelve a resolver
  const moved = Math.abs(current.lat - lat) > 1e-6 || Math.abs(current.lng - lng) > 1e-6;
  let loc: ResolvedLocality | null = null;
  if (moved) {
    try {
      loc = await resolveLocality({ lat, lng });
    } catch (e) {
      console.error("[panel] locality resolve failed:", (e as Error).message);
    }
    if (!loc) return { error: LOCALITY_ERROR };
  }
  const locality_id = loc?.id ?? current.locality_id;

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

  if (error) return dbError(error);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update",
    new_data:   { ...parsed.data, locality_id, ...(loc ? { locality_source: loc.source } : {}) },
  });
  if (auditErr) return auditError(auditErr);
  if (loc) {
    const locAuditErr = await auditCreatedLocality(supabase, user.id, venueId, loc, { lat, lng });
    if (locAuditErr) return auditError(locAuditErr);
  }

  revalidatePath(`/panel/complejos/${venueId}`);
  revalidatePath("/panel/complejos");
  redirect("/panel/complejos");
}

// ---------------------------------------------------------------------------
// Logo del club (migración 024). Se sube con la sesión del dueño: las
// políticas de storage limitan la carpeta '{venue_id}/' al dueño del complejo
// y venues_logo_path_check obliga a que logo_path esté en esa carpeta.
// ---------------------------------------------------------------------------

const LOGO_ERRORS = {
  missing:  "Elegí una imagen.",
  tooBig:   "El logo puede pesar hasta 10 MB.",
  badType:  "El logo tiene que ser una imagen PNG, JPG o WebP.",
  shrink:   "No pudimos achicar esta imagen. Probá con otra.",
  upload:   "No se pudo subir el logo. Intentá de nuevo.",
} as const;

/** El complejo, solo si es del usuario de la sesión. */
async function ownedVenueLogo(supabase: Awaited<ReturnType<typeof createClient>>, venueId: string, userId: string) {
  if (!z.string().guid().safeParse(venueId).success) return null;
  const { data } = await supabase
    .from("venues")
    .select("id, logo_path")
    .eq("id", venueId)
    .eq("owner_id", userId)
    .maybeSingle();
  return data;
}

export async function uploadVenueLogoAction(
  venueId: string,
  _state: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const venue = await ownedVenueLogo(supabase, venueId, user.id);
  if (!venue) return { error: "No autorizado" };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { logo: [LOGO_ERRORS.missing] } };
  if (file.size > LOGO_UPLOAD_MAX_BYTES) return { fieldErrors: { logo: [LOGO_ERRORS.tooBig] } };

  // Tipo real por los primeros bytes: la extensión y el Content-Type los elige el que sube
  const original = new Uint8Array(await file.arrayBuffer());
  const type = detectLogoType(original);
  if (!type) return { fieldErrors: { logo: [LOGO_ERRORS.badType] } };

  // Se achica en el servidor (1024 px, < 512 KB, mismo formato) antes de subirlo
  const bytes = await shrinkLogo(original, type);
  if (!bytes) return { fieldErrors: { logo: [LOGO_ERRORS.shrink] } };

  // Nombre nuevo en cada subida: la URL pública cambia y nadie ve el logo viejo de caché
  const path = `${venueId}/logo-${Date.now()}.${type.ext}`;
  const { error: upErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: type.mime, upsert: false, cacheControl: "31536000" });
  if (upErr) {
    console.error("[panel] logo upload failed:", upErr.message);
    return { error: LOGO_ERRORS.upload };
  }

  const { error } = await supabase
    .from("venues")
    .update({ logo_path: path })
    .eq("id", venueId)
    .eq("owner_id", user.id);
  if (error) {
    await supabase.storage.from(LOGO_BUCKET).remove([path]);
    return dbError(error);
  }

  if (venue.logo_path && venue.logo_path !== path) {
    const { error: rmErr } = await supabase.storage.from(LOGO_BUCKET).remove([venue.logo_path]);
    if (rmErr) console.error("[panel] old logo remove failed:", rmErr.message);
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update",
    new_data:   { logo_path: path },
  });
  if (auditErr) return auditError(auditErr);

  revalidatePath(`/panel/complejos/${venueId}`);
  return {};
}

export async function removeVenueLogoAction(
  venueId: string,
  _state: PanelActionState,
  _formData: FormData
): Promise<PanelActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const venue = await ownedVenueLogo(supabase, venueId, user.id);
  if (!venue) return { error: "No autorizado" };
  if (!venue.logo_path) return {};

  const { error } = await supabase
    .from("venues")
    .update({ logo_path: null })
    .eq("id", venueId)
    .eq("owner_id", user.id);
  if (error) return dbError(error);

  const { error: rmErr } = await supabase.storage.from(LOGO_BUCKET).remove([venue.logo_path]);
  if (rmErr) console.error("[panel] logo remove failed:", rmErr.message);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update",
    new_data:   { logo_path: null },
  });
  if (auditErr) return auditError(auditErr);

  revalidatePath(`/panel/complejos/${venueId}`);
  return {};
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
    if (mpError) {
      console.error("[panel] mp_accounts lookup failed:", mpError.code ?? "", mpError.message);
      return { error: "No se pudo verificar Mercado Pago. Intentá de nuevo." };
    }
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
  if (error) return dbError(error);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update_payment_settings",
    new_data:   settings,
  });
  if (auditErr) return auditError(auditErr);

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
  if (error) return dbError(error);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "venue",
    entity_id:  venueId,
    action:     "update_cancellation_policy",
    new_data:   parsed.data,
  });
  if (auditErr) return auditError(auditErr);

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
  // Migración 023: etiquetas de la cancha ("" = sin indicar)
  surface:         z.enum(["sintetico", "pasto", "cemento", "polvo_ladrillo", "blindex"]).nullable(),
  covered:         z.boolean(),
  lit:             z.boolean(),
  has_locker_room: z.boolean(),
  // Migración 027: formato, solo fútbol (sin elegir = NULL)
  format:          z.enum(FORMAT_VALUES, { error: "Elegí un formato de la lista" }).nullable(),
  // Migración 027: aclaraciones libres, 200 caracteres como máximo ("" = sin aclaraciones)
  notes:           z.string().max(200, "Hasta 200 caracteres.").nullable(),
});

/** Etiquetas del formulario: superficie (select), tres interruptores y el formato (botones). */
function courtFeaturesFrom(formData: FormData) {
  const surface = String(formData.get("surface") ?? "");
  const format = String(formData.get("format") ?? "");
  // Texto plano: se guarda tal cual (sin espacios de más) y se muestra escapado
  const notes = String(formData.get("notes") ?? "").replace(/\s+/g, " ").trim();
  return {
    notes:           notes === "" ? null : notes,
    surface:         surface === "" ? null : surface,
    covered:         formData.get("covered") !== null,
    lit:             formData.get("lit") !== null,
    has_locker_room: formData.get("has_locker_room") !== null,
    format:          format === "" ? null : format,
  };
}

/**
 * El formato solo vale para fútbol: si la cancha es (o pasa a ser) de pádel o
 * tenis se manda NULL (el trigger enforce_court_format de la 027 rechazaría otro valor).
 */
async function formatForSport(
  supabase: Awaited<ReturnType<typeof createClient>>, sportId: string, format: string | null,
): Promise<{ slug: string | null; format: string | null }> {
  const { data: sport } = await supabase.from("sports").select("slug").eq("id", sportId).maybeSingle();
  const slug = sport?.slug ?? null;
  return { slug, format: slug === "futbol" ? format : null };
}

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
    ...courtFeaturesFrom(formData),
  };
  const parsed = CourtSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { slug: sportSlug, format } = await formatForSport(supabase, parsed.data.sport_id, parsed.data.format);
  parsed.data.format = format as typeof parsed.data.format;

  const { data: court, error } = await supabase
    .from("courts")
    .insert({
      venue_id:     venueId,
      name:         parsed.data.name,
      sport_id:     parsed.data.sport_id,
      slot_minutes: parsed.data.slot_minutes,
      active:       parsed.data.active,
      surface:         parsed.data.surface,
      covered:         parsed.data.covered,
      lit:             parsed.data.lit,
      has_locker_room: parsed.data.has_locker_room,
      format,
      notes:           parsed.data.notes,
    })
    .select("id")
    .single();

  if (error) return dbError(error);

  // Horarios precargados según deporte (SPEC §12)
  const sport = sportSlug ? { slug: sportSlug } : null;

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
  if (auditErr) return auditError(auditErr);

  revalidatePath(`/panel/complejos/${venueId}/canchas`);
  // Paso 2 de 3 (precios), con el aviso "Cancha cargada"
  redirect(`/panel/complejos/${venueId}/canchas/${court.id}?paso=precios`);
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
    ...courtFeaturesFrom(formData),
  };
  const parsed = CourtSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  // Si la cancha pasa a pádel o tenis, format = NULL
  const { format } = await formatForSport(supabase, parsed.data.sport_id, parsed.data.format);
  parsed.data.format = format as typeof parsed.data.format;

  const { error } = await supabase
    .from("courts")
    .update({
      name:         parsed.data.name,
      sport_id:     parsed.data.sport_id,
      slot_minutes: parsed.data.slot_minutes,
      active:       parsed.data.active,
      surface:         parsed.data.surface,
      covered:         parsed.data.covered,
      lit:             parsed.data.lit,
      has_locker_room: parsed.data.has_locker_room,
      format,
      notes:           parsed.data.notes,
    })
    .eq("id", courtId)
    .eq("venue_id", venueId);

  if (error) return dbError(error);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "court",
    entity_id:  courtId,
    action:     "update",
    new_data:   parsed.data,
  });
  if (auditErr) return auditError(auditErr);

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
  if (delErr) return dbError(delErr);

  if (hours.length > 0) {
    const { error: insErr } = await supabase.from("court_hours").insert(hours);
    if (insErr) return dbError(insErr);
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "court_hours",
    entity_id:  courtId,
    action:     "update",
    new_data:   hours,
  });
  if (auditErr) return auditError(auditErr);

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
  if (delErr) return dbError(delErr);

  if (prices.length > 0) {
    const { error: insErr } = await supabase.from("court_prices").insert(prices);
    if (insErr) return dbError(insErr);
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "court_prices",
    entity_id:  courtId,
    action:     "update",
    new_data:   prices,
  });
  if (auditErr) return auditError(auditErr);

  revalidatePath(`/panel/complejos/${venueId}/canchas/${courtId}`);
  return null;
}

// ---------------------------------------------------------------------------
// Agenda: booking management actions
// ---------------------------------------------------------------------------
// Desde la migración 021 el dueño no escribe directo en bookings: cada acción
// llama a un RPC SECURITY DEFINER (panel_*) que verifica que el complejo sea
// suyo, que la reserva/cancha sea de ese complejo y valida los datos.

export async function cancelBookingPanelAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const parsed = BookingRefSchema.safeParse({
    booking_id: formData.get("booking_id"),
    venue_id:   formData.get("venue_id"),
  });
  if (!parsed.success) return { error: "Datos incompletos" };
  const { booking_id: bookingId, venue_id: venueId } = parsed.data;
  const date = formData.get("date") as string | null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // Cancela solo si está confirmada (dos clicks no disparan dos devoluciones).
  // Si hay pago online acreditado, el RPC lo deja 'refund_pending' en la misma
  // transacción: cuando cancela el complejo se devuelve siempre.
  const rpc = await callPanelRpc(supabase, "panel_cancel_booking", {
    p_booking_id: bookingId,
    p_venue_id:   venueId,
  });
  if (!rpc.ok) return rpc.state;
  const res = rpc.data;

  const refundDue =
    res.refund_due === true && typeof res.mp_order_id === "string" && typeof res.mp_payment_id === "string";
  const refundAmount = refundDue ? Number(res.refund_amount ?? 0) : 0;

  // Devolución (misma función idempotente que el webhook y el jugador). Si
  // falla acá, el pago queda en 'refund_failed' y el cron la reintenta.
  let refundStatus: "none" | "refunded" | "pending" = "none";
  const admin = createAdminClient();
  if (refundDue) {
    const refund = await refundPayment(admin, {
      bookingId,
      venueId,
      orderId:     res.mp_order_id as string,
      paymentId:   res.mp_payment_id as string,
      amount:      refundAmount,
      paymentType: res.payment_type === "full" ? "full" : "deposit",
      reason:      "owner_cancelled",
      source:      "owner_cancel",
      markBookingRefunded: true,
    });
    refundStatus = refund.ok ? "refunded" : "pending";
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  bookingId,
    action:     "cancel",
    new_data:   {
      refund:        refundStatus,
      refund_amount: refundAmount,
      ...(refundDue ? { mp_payment_id: res.mp_payment_id as string } : {}),
    },
  });
  if (auditErr) return auditError(auditErr);

  // Aviso al dueño (best-effort). Va con service_role: el dueño no escribe en
  // notification_outbox desde la 021.
  const { error: outboxErr } = await admin.from("notification_outbox").insert({
    venue_id: venueId,
    type:     "booking_cancelled",
    payload:  {
      booking_id:     bookingId,
      customer_name:  (res.customer_name as string | null) ?? null,
      customer_phone: (res.customer_phone as string | null) ?? null,
      start:          (res.start as string | null) ?? null,
      cancelled_by:   "owner",
      amount_paid:    Number(res.amount_paid ?? 0),
      refund_due:     refundDue,
      refund_amount:  refundAmount,
      refund_status:  refundStatus,
    },
  });
  if (outboxErr) console.error("[panel] outbox insert failed on cancel:", outboxErr.code ?? "", outboxErr.message);
  void triggerPushSend();

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

/**
 * Marcar pagado (cobrado en el complejo). El monto sale de la base
 * (price_total), no del formulario. Si se pagó el total online no se permite;
 * si se pagó una seña online, registra que el resto se cobró en el complejo.
 */
export async function markPaidAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const parsed = BookingRefSchema.safeParse({
    booking_id: formData.get("booking_id"),
    venue_id:   formData.get("venue_id"),
  });
  if (!parsed.success) return { error: "Datos incompletos" };
  const { booking_id: bookingId, venue_id: venueId } = parsed.data;
  const date = formData.get("date") as string | null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // El RPC también encola el aviso 'payment_received'.
  const rpc = await callPanelRpc(supabase, "panel_mark_paid", {
    p_booking_id: bookingId,
    p_venue_id:   venueId,
  });
  if (!rpc.ok) return rpc.state;

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  bookingId,
    action:     "mark_paid",
    new_data:   { price_total: Number(rpc.data.price_total ?? 0), online_paid: Number(rpc.data.online_paid ?? 0) },
  });
  if (auditErr) return auditError(auditErr);

  void triggerPushSend();

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

/**
 * Marcar ausente. Una reserva pagada online solo se puede marcar después de
 * que empezó el turno: antes, el camino es cancelar (que devuelve la plata).
 */
export async function markNoShowAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const parsed = BookingRefSchema.safeParse({
    booking_id: formData.get("booking_id"),
    venue_id:   formData.get("venue_id"),
  });
  if (!parsed.success) return { error: "Datos incompletos" };
  const { booking_id: bookingId, venue_id: venueId } = parsed.data;
  const date = formData.get("date") as string | null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rpc = await callPanelRpc(supabase, "panel_mark_no_show", {
    p_booking_id: bookingId,
    p_venue_id:   venueId,
  });
  if (!rpc.ok) return rpc.state;

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  bookingId,
    action:     "mark_no_show",
  });
  if (auditErr) return auditError(auditErr);

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

const BlockPhoneSchema = z.object({
  venue_id: z.string().guid(),
  phone:    z.string().max(30),
});

export async function blockPhonePanelAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const parsed = BlockPhoneSchema.safeParse({
    venue_id: formData.get("venue_id"),
    phone:    formData.get("phone"),
  });
  if (!parsed.success) return { error: "Datos incompletos" };
  const { venue_id: venueId, phone } = parsed.data;
  const date = formData.get("date") as string | null;

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
  if (normalizedPhone.length < 7 || normalizedPhone.length > 15) return { error: "Teléfono inválido" };

  // Si ya estaba bloqueado no hace nada (ON CONFLICT DO NOTHING: no requiere UPDATE).
  const { error } = await supabase
    .from("blocked_phones")
    .upsert({ venue_id: venueId, phone: normalizedPhone }, { onConflict: "venue_id,phone", ignoreDuplicates: true });
  if (error) return dbError(error);

  const { error: blockAuditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "blocked_phone",
    entity_id:  venueId,
    action:     "create",
    new_data:   { phone: normalizedPhone },
  });
  if (blockAuditErr) return auditError(blockAuditErr);

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const ManualBlockSchema = z.object({
  venue_id: z.string().guid(),
  court_id: z.string().guid(),
  start:    z.string().regex(LOCAL_DATETIME), // "YYYY-MM-DDTHH:MM" hora de Mendoza
  end:      z.string().regex(LOCAL_DATETIME),
  note:     z.string().trim().max(80, "La nota puede tener hasta 80 caracteres."),
});

export async function createManualBlockAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const parsed = ManualBlockSchema.safeParse({
    venue_id: formData.get("venue_id"),
    court_id: formData.get("court_id"),
    start:    formData.get("start"),
    end:      formData.get("end"),
    note:     formData.get("note") ?? "",
  });
  if (!parsed.success) {
    const noteErr = parsed.error.flatten().fieldErrors.note?.[0];
    return { error: noteErr ?? "Datos incompletos" };
  }
  const { venue_id: venueId, court_id: courtId, start, end } = parsed.data;
  const note = parsed.data.note || "Bloqueo";
  const date = formData.get("date") as string | null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // start/end son "YYYY-MM-DDTHH:MM" en hora de Mendoza (UTC-3)
  const startDate = new Date(start + ":00-03:00");
  const endDate   = new Date(end   + ":00-03:00");
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return { error: "Datos incompletos" };
  if (startDate >= endDate) return { error: "El inicio debe ser antes que el fin" };

  // El RPC verifica que el complejo sea del dueño y la cancha de ese complejo.
  const rpc = await callPanelRpc(supabase, "panel_create_block", {
    p_venue_id: venueId,
    p_court_id: courtId,
    p_start:    startDate.toISOString(),
    p_end:      endDate.toISOString(),
    p_note:     note,
  });
  if (!rpc.ok) return rpc.state;

  const { error: blockCreateAuditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  rpc.data.booking_id as string,
    action:     "create_block",
    new_data:   { court_id: courtId, start: startDate.toISOString(), end: endDate.toISOString(), note },
  });
  if (blockCreateAuditErr) return auditError(blockCreateAuditErr);

  revalidatePath(`/panel/complejos/${venueId}/agenda`);
  if (date) revalidatePath(`/panel/complejos/${venueId}/agenda?fecha=${date}`);
  return null;
}

const ManualBookingSchema = z.object({
  venue_id:       z.string().guid(),
  court_id:       z.string().guid(),
  start:          z.iso.datetime({ offset: true }),
  end:            z.iso.datetime({ offset: true }),
  customer_name:  z.string().trim().max(80),
  customer_phone: z.string().trim().max(30),
});

/**
 * El dueño carga un turno (el jugador llamó o escribió). Migración 026:
 * panel_create_booking valida igual que la reserva pública (horario, grilla,
 * precio, celular, teléfono bloqueado) y lo deja confirmado y sin pagar.
 */
export async function createBookingPanelAction(
  _prevState: PanelActionState,
  formData: FormData
): Promise<PanelActionState> {
  const parsed = ManualBookingSchema.safeParse({
    venue_id:       formData.get("venue_id"),
    court_id:       formData.get("court_id"),
    start:          formData.get("start"),
    end:            formData.get("end"),
    customer_name:  formData.get("customer_name") ?? "",
    customer_phone: formData.get("customer_phone") ?? "",
  });
  if (!parsed.success) return { error: "Elegí un horario libre." };
  const { venue_id: venueId, court_id: courtId, start, end, customer_name, customer_phone } = parsed.data;
  if (customer_name.length < 2) return { fieldErrors: { customer_name: [PANEL_RPC_MESSAGES.invalid_name] } };
  if (customer_phone.replace(/\D/g, "").length < 8) return { fieldErrors: { customer_phone: [PANEL_RPC_MESSAGES.invalid_phone] } };
  const date = formData.get("date") as string | null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rpc = await callPanelRpc(supabase, "panel_create_booking", {
    p_venue_id:       venueId,
    p_court_id:       courtId,
    p_start:          start,
    p_end:            end,
    p_customer_name:  customer_name,
    p_customer_phone: customer_phone,
  });
  if (!rpc.ok) {
    const msg = rpc.state?.error;
    if (msg === PANEL_RPC_MESSAGES.invalid_name) return { fieldErrors: { customer_name: [msg] } };
    if (msg === PANEL_RPC_MESSAGES.invalid_phone) return { fieldErrors: { customer_phone: [msg] } };
    return rpc.state;
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "booking",
    entity_id:  rpc.data.booking_id as string,
    action:     "create",
    new_data:   { court_id: courtId, start, end, source: "manual", price_total: Number(rpc.data.price_total ?? 0) },
  });
  if (auditErr) return auditError(auditErr);

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
  if (error) return dbError(error);

  const { error: auditErr } = await supabase.from("audit_log").insert({
    profile_id: user.id,
    venue_id:   venueId,
    entity:     "blocked_phone",
    entity_id:  venueId,
    action:     "delete",
    new_data:   { phone },
  });
  if (auditErr) return auditError(auditErr);

  revalidatePath(`/panel/complejos/${venueId}/bloqueados`);
  return null;
}
