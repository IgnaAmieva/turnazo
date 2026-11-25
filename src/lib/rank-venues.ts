import type { FreeSlot, VenueForList } from '@/lib/free-slots';
import { inWhen, type When } from '@/lib/franjas';

/**
 * Complejos con lugar en esa franja/hora, primero el que tiene MÁS turnos
 * libres (así los turnos se reparten entre todos); desempata el nombre.
 * Los que no tienen lugar no aparecen. `next`: hasta 4 horarios distintos.
 */
export function rankVenues(venues: VenueForList[], slots: FreeSlot[], when: When, today: string) {
  return venues
    .map((v) => {
      const mine = slots.filter((s) => s.venueId === v.id && inWhen(s.start, when, today));
      // Horarios distintos (con dos canchas libres a la misma hora, un solo chip: la primera cancha)
      const times = mine.filter((s, i, all) => all.findIndex((o) => o.start.getTime() === s.start.getTime()) === i);
      return { v, free: mine.length, next: times.slice(0, 4) };
    })
    .filter((r) => r.free > 0)
    .sort((a, b) => b.free - a.free || a.v.name.localeCompare(b.v.name, 'es'));
}
