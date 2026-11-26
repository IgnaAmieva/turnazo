/** Estado de un complejo (venue_status, 028 sumó 'rejected'): etiqueta y colores (AA en claro y oscuro). */
export type VenueStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export const VENUE_STATUSES: VenueStatus[] = ['pending', 'approved', 'suspended', 'rejected'];

export const VENUE_STATUS: Record<VenueStatus, { label: string; plural: string; className: string }> = {
  pending:   { label: 'Pendiente',  plural: 'Pendientes',  className: 'bg-warning-soft text-warning ring-warning/40' },
  approved:  { label: 'Aprobado',   plural: 'Aprobados',   className: 'bg-accent text-on-accent ring-transparent' },
  suspended: { label: 'Suspendido', plural: 'Suspendidos', className: 'bg-danger-soft text-danger ring-danger/40' },
  rejected:  { label: 'Rechazado',  plural: 'Rechazados',  className: 'bg-surface-2 text-ink ring-line' },
};

export function isVenueStatus(v: unknown): v is VenueStatus {
  return typeof v === 'string' && (VENUE_STATUSES as string[]).includes(v);
}

export function venueStatus(v: string) {
  return VENUE_STATUS[isVenueStatus(v) ? v : 'pending'];
}

/** Acciones del superadmin según el estado (mismas transiciones que superadmin_set_venue_status). */
export type AdminAction = 'approve' | 'reject' | 'suspend' | 'reactivate';

export function actionsFor(status: string): AdminAction[] {
  switch (status) {
    case 'pending':   return ['approve', 'reject'];
    case 'approved':  return ['suspend'];
    case 'suspended': return ['reactivate'];
    case 'rejected':  return ['approve'];
    default:          return [];
  }
}

export const ADMIN_ACTION: Record<AdminAction, {
  label: string; confirm: string; reason: 'required' | 'optional' | 'none'; danger: boolean;
}> = {
  approve:    { label: 'Aprobar',    confirm: 'Sí, aprobar',    reason: 'none',     danger: false },
  reject:     { label: 'Rechazar',   confirm: 'Sí, rechazar',   reason: 'required', danger: true },
  suspend:    { label: 'Suspender',  confirm: 'Sí, suspender',  reason: 'optional', danger: true },
  reactivate: { label: 'Reactivar',  confirm: 'Sí, reactivar',  reason: 'none',     danger: false },
};

/** Mensaje de WhatsApp para el dueño (lo abre el superadmin; nada se manda solo). */
export function ownerWhatsAppText(action: 'approve' | 'reject', venueName: string, panelUrl: string, reason?: string | null): string {
  return action === 'approve'
    ? `¡Hola! Tu complejo ${venueName} ya está aprobado en Depoturnos: los jugadores ya pueden encontrarlo y reservar. Entrá al panel para revisar tus canchas y horarios: ${panelUrl}`
    : `Hola. Revisamos ${venueName} en Depoturnos y por ahora no lo pudimos aprobar. Motivo: ${reason ?? ''}. Si lo corregís o tenés dudas, respondé este mensaje.`;
}
