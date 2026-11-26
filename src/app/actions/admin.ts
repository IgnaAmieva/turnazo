'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { triggerPushSend } from '@/lib/push';
import { buildWhatsAppUrl } from '@/lib/phone';
import { originFrom } from '@/lib/mi-turno';
import { ownerWhatsAppText, type AdminAction } from '@/lib/venue-status';

export type AdminActionState = {
  error?: string;
  ok?: boolean;
  action?: AdminAction;
  newStatus?: string;
  /** Aprobado / rechazado: link de WhatsApp al dueño con el mensaje armado */
  whatsappUrl?: string | null;
};

const Schema = z.object({
  venueId: z.string().guid(),
  action:  z.enum(['approve', 'reject', 'suspend', 'reactivate']),
  reason:  z.string().trim().max(500).optional(),
});

const ERRORS: Record<string, string> = {
  forbidden:          'No tenés permiso para hacer esto.',
  venue_not_found:    'El complejo ya no existe.',
  invalid_transition: 'El complejo cambió de estado mientras lo mirabas. Recargá la página.',
  reason_required:    'Escribí el motivo del rechazo (al menos 5 letras): se lo mandamos al dueño.',
  reason_too_long:    'El motivo es muy largo (hasta 500 letras).',
};

/**
 * Aprobar / Rechazar / Suspender / Reactivar. Todo lo decide la base
 * (superadmin_set_venue_status): verifica el rol, la transición, escribe en
 * audit_log y encola el push al dueño en la misma transacción.
 */
export async function setVenueStatusAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const parsed = Schema.safeParse({
    venueId: formData.get('venue_id'),
    action:  formData.get('action'),
    reason:  formData.get('reason') ?? undefined,
  });
  if (!parsed.success) return { error: 'Pedido inválido.' };
  const { venueId, action, reason } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: ERRORS.forbidden };

  const { data, error } = await supabase.rpc('superadmin_set_venue_status', {
    p_venue_id: venueId, p_action: action, p_reason: reason || null,
  });
  if (error) {
    console.error('[admin] set_venue_status', error.code, error.message);
    return { error: error.code === '42501' ? ERRORS.forbidden : 'No se pudo guardar. Probá de nuevo.' };
  }
  const res = (data ?? {}) as { ok?: boolean; error?: string; new_status?: string };
  if (res.error) return { error: ERRORS[res.error] ?? 'No se pudo guardar. Probá de nuevo.' };

  let whatsappUrl: string | null = null;
  if (action === 'approve' || action === 'reject') {
    // El push al dueño ya quedó en notification_outbox: mandarlo ahora (best-effort)
    void triggerPushSend();
    const { data: v } = await supabase.from('venues').select('name, phone').eq('id', venueId).maybeSingle();
    if (v?.phone) {
      const panelUrl = `${originFrom(await headers())}/panel`;
      whatsappUrl = buildWhatsAppUrl(v.phone, ownerWhatsAppText(action, v.name, panelUrl, reason));
    }
  }

  revalidatePath('/admin', 'layout');
  return { ok: true, action, newStatus: res.new_status, whatsappUrl };
}
