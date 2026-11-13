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
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <Link href="/panel/agenda" className="text-sm text-gray-500 hover:text-gray-700">
          ← Agenda
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-lg font-semibold text-gray-900">{data.venueName}</h1>
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
