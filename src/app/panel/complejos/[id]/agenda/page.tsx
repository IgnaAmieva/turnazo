export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getAgendaData } from "@/lib/supabase/panel-queries";
import { generateSlots, mendozaToUtc, todayInMendoza, weekdayInMendoza } from "@/lib/slots";
import AgendaDay, { type FreeSlot } from "@/components/panel/agenda-day";
import {
  cancelBookingPanelAction,
  markPaidAction,
  markNoShowAction,
  blockPhonePanelAction,
  createManualBlockAction,
  createBookingPanelAction,
} from "@/app/actions/panel";

type Props = {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ fecha?: string }>;
};

export default async function AgendaPage({ params, searchParams }: Props) {
  const { id: venueId } = await params;
  const { fecha }       = await searchParams;
  const now   = new Date();
  const today = todayInMendoza(now);
  const date  = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : today;

  const data = await getAgendaData(venueId, date);
  if (!data) notFound();

  // Turnos libres del día (los de hoy, solo los que todavía no empezaron; un día pasado, ninguno)
  const weekday = weekdayInMendoza(date);
  const dayEnd  = mendozaToUtc(date, "00:00:00").getTime() + 24 * 3600 * 1000;
  const free: FreeSlot[] = date < today ? [] : data.courts.flatMap((c) =>
    generateSlots({
      date,
      hours: c.hours.filter((h) => h.weekday === weekday),
      slotMinutes: c.slot_minutes,
      booked: data.bookings
        .filter((b) => b.court_id === c.id && (b.status === "confirmed" || b.status === "hold"))
        .map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
      prices: [],
      cutoff: date === today ? now : undefined,
    })
      // La agenda muestra las reservas de 00:00 a 24:00: los turnos de después de medianoche, al día siguiente
      .filter((s) => s.available && s.start.getTime() < dayEnd)
      .map((s) => ({ courtId: c.id, start: s.start.toISOString(), end: s.end.toISOString() })),
  );

  return (
    <AgendaDay
      venueId={venueId}
      venueName={data.venueName}
      whatsappTemplate={data.whatsappTemplate}
      date={date}
      today={today}
      nowIso={now.toISOString()}
      courts={data.courts}
      bookings={data.bookings}
      free={free}
      onCancel={cancelBookingPanelAction}
      onMarkPaid={markPaidAction}
      onMarkNoShow={markNoShowAction}
      onBlockPhone={blockPhonePanelAction}
      onCreateBlock={createManualBlockAction}
      onCreateBooking={createBookingPanelAction}
    />
  );
}
