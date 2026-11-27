import type { FreeSlot, VenueForList } from '@/lib/free-slots';
import { inWhen, type When } from '@/lib/franjas';

/**
 * Complejos con lugar a esa hora (o en cualquier horario), primero el que
 * tiene MÁS turnos libres en el día (así los turnos se reparten entre todos);
 * desempata el nombre. Los que no tienen lugar no aparecen.
 * `next`: hasta 4 horarios distintos desde la hora elegida (o los próximos).
 */
export function rankVenues(venues: VenueForList[], slots: FreeSlot[], when: When) {
  return venues
    .map((v) => {
      const mine = slots.filter((s) => s.venueId === v.id);
      const atTime = mine.filter((s) => inWhen(s.start, when));
      // Con hora elegida: ese turno primero y después los siguientes del día
      const from = when.kind === 'time' && atTime.length ? atTime[0].start.getTime() : -Infinity;
      const pool = mine.filter((s) => s.start.getTime() >= from);
      // Horarios distintos (con dos canchas libres a la misma hora, un solo chip: la primera cancha)
      const times = pool.filter((s, i, all) => all.findIndex((o) => o.start.getTime() === s.start.getTime()) === i);
      return { v, free: when.kind === 'time' ? atTime.length : mine.length, total: mine.length, next: times.slice(0, 4) };
    })
    .filter((r) => r.free > 0)
    .sort((a, b) => b.total - a.total || a.v.name.localeCompare(b.v.name, 'es'));
}
