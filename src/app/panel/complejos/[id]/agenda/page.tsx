export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgendaData } from "@/lib/supabase/panel-queries";
import { todayInMendoza } from "@/lib/slots";
import AgendaGrid from "@/components/panel/agenda-grid";
import {
  cancelBookingPanelAction,
  markPaidAction,
  markNoShowAction,
  blockPhonePanelAction,
  createManualBlockAction,
} from "@/app/actions/panel";

type Props = {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ fecha?: string }>;
};

export default async function AgendaPage({ params, searchParams }: Props) {
  const { id: venueId } = await params;
  const { fecha }       = await searchParams;
  const date = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : todayInMendoza();

  const data = await getAgendaData(venueId, date);
  if (!data) notFound();

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4 shrink-0">
        <Link href="/panel/agenda" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">
          ← Agenda
        </Link>
        <span className="text-ink-muted">/</span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{data.venueName}</h1>
        <Link
          href={`/panel/complejos/${venueId}/historia`}
          data-testid="compartir-turnos"
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-extrabold text-on-primary shadow-sm hover:opacity-90"
        >
          Compartir turnos libres
        </Link>
      </div>

      <AgendaGrid
        venueId={venueId}
        venueName={data.venueName}
        whatsappTemplate={data.whatsappTemplate}
        date={date}
        todayMendoza={todayInMendoza()}
        courts={data.courts}
        bookings={data.bookings}
        onCancel={cancelBookingPanelAction}
        onMarkPaid={markPaidAction}
        onMarkNoShow={markNoShowAction}
        onBlockPhone={blockPhonePanelAction}
        onCreateBlock={createManualBlockAction}
      />
    </div>
  );
}
