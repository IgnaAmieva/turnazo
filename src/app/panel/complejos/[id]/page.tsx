import { notFound } from "next/navigation";
import { getOwnerVenue, getMpConnectionStatus } from "@/lib/supabase/panel-queries";
import {
  updateVenueAction, updatePaymentSettingsAction, updateCancellationPolicyAction,
  uploadVenueLogoAction, removeVenueLogoAction,
} from "@/app/actions/panel";
import { VenueForm } from "@/components/panel/venue-form";
import { MpConnectSection } from "@/components/panel/mp-connect-section";
import { PaymentSettingsSection } from "@/components/panel/payment-settings-section";
import { CancellationPolicySection } from "@/components/panel/cancellation-policy-section";
import { VenueLogoSection } from "@/components/panel/venue-logo-section";
import Link from "next/link";
import { Suspense } from "react";

export default async function EditarComplejoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [venue, mpConnection] = await Promise.all([
    getOwnerVenue(id),
    getMpConnectionStatus(id),
  ]);

  if (!venue) notFound();

  const boundAction = updateVenueAction.bind(null, id);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-ink-muted hover:text-ink">
          ← Complejos
        </Link>
        <span className="text-ink-muted">/</span>
        <h1 className="text-xl font-semibold text-ink truncate">{venue.name}</h1>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href={`/panel/complejos/${id}/canchas`}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted hover:border-primary hover:text-ink transition-colors"
        >
          Canchas
        </Link>
        <Link
          href={`/panel/complejos/${id}/agenda`}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted hover:border-primary hover:text-ink transition-colors"
        >
          Agenda
        </Link>
        <Link
          href={`/panel/complejos/${id}/bloqueados`}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted hover:border-primary hover:text-ink transition-colors"
        >
          Teléfonos bloqueados
        </Link>
      </div>

      {/* Logo del club (portada e historias) */}
      <div className="mb-6">
        <VenueLogoSection
          key={venue.logo_path ?? "sin-logo"}
          name={venue.name}
          logoPath={venue.logo_path}
          upload={uploadVenueLogoAction.bind(null, id)}
          remove={removeVenueLogoAction.bind(null, id)}
        />
      </div>

      {/* Mercado Pago connection */}
      <Suspense fallback={null}>
        <MpConnectSection venueId={id} mpConnection={mpConnection} />
      </Suspense>

      {/* Payment settings — remounts when MP gets connected/disconnected */}
      <div className="mt-6">
        <PaymentSettingsSection
          key={mpConnection ? "mp-connected" : "mp-disconnected"}
          action={updatePaymentSettingsAction.bind(null, id)}
          mpConnected={!!mpConnection}
          settings={{
            deposit_required:   venue.deposit_required,
            deposit_type:       venue.deposit_type,
            deposit_value:      venue.deposit_value,
            allow_full_payment: venue.allow_full_payment,
            allow_pay_at_venue: venue.allow_pay_at_venue,
          }}
        />
      </div>

      {/* Cancellation policy */}
      <div className="mt-6">
        <CancellationPolicySection
          action={updateCancellationPolicyAction.bind(null, id)}
          settings={{
            cancel_limit_hours: venue.cancel_limit_hours,
            refund_policy:      venue.refund_policy,
          }}
        />
      </div>

      <div className="mt-6 bg-surface rounded-2xl border border-line p-6">
        <VenueForm
          action={boundAction}
          localityName={venue.locality_name}
          venue={venue}
          submitLabel="Guardar cambios"
        />
      </div>
    </div>
  );
}
