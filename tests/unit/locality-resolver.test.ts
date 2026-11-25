/**
 * Localidad desde el pin (propuesta aprobada con la 027): primero una existente
 * a menos de 6 km, después Georef desde el servidor (crea si no existe), y si
 * Georef falla, la más cercana marcada 'fallback'. Sin red ni base: Georef y la
 * tabla se simulan.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveLocality, type LocalityRow } from '@/lib/locality-resolver';
import { slugify, byDistance } from '@/lib/geo';

const LOCS: LocalityRow[] = [
  { id: 'tun', name: 'Tunuyán', slug: 'tunuyan', lat: -33.5812532, lng: -69.0153686 },
  { id: 'sc', name: 'San Carlos', slug: 'san-carlos', lat: -33.7720666, lng: -69.0403915 },
  { id: 'tup', name: 'Tupungato', slug: 'tupungato', lat: -33.3728409, lng: -69.1475743 },
  { id: 'lc', name: 'La Consulta', slug: 'la-consulta', lat: -33.7338472, lng: -69.1198853 },
];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function georef(municipio: { id: string; nombre: string } | null, centro?: { lat: number; lon: number }) {
  return vi.fn((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/ubicacion')) {
      return json({ ubicacion: municipio
        ? { provincia: { id: '50', nombre: 'Mendoza' }, departamento: { id: 'd', nombre: municipio.nombre }, municipio }
        : { provincia: { id: null, nombre: null }, departamento: { id: null, nombre: null }, municipio: { id: null, nombre: null } } });
    }
    if (u.includes('/municipios')) return json({ municipios: centro ? [{ centroide: centro }] : [] });
    return json({}, 404);
  }) as unknown as typeof fetch;
}

const deps = (fetchImpl: typeof fetch) => {
  const insertLocality = vi.fn(async (row: Omit<LocalityRow, 'id'>) => ({ id: 'nueva', ...row }));
  return { fetch: fetchImpl, listLocalities: async () => LOCS, insertLocality };
};

describe('resolveLocality', () => {
  it('un pin a menos de 6 km de una localidad existente usa esa, sin llamar a Georef', async () => {
    const f = georef({ id: '500119', nombre: 'Tunuyán' });
    const d = deps(f);
    const r = await resolveLocality({ lat: -33.5867, lng: -69.0119 }, d);   // futmates
    expect(r).toEqual({ id: 'tun', name: 'Tunuyán', source: 'near', created: false });
    expect(f).not.toHaveBeenCalled();
    expect(d.insertLocality).not.toHaveBeenCalled();
  });

  it('La Consulta: gana la localidad cercana aunque Georef diría "San Carlos" (municipio = departamento)', async () => {
    const d = deps(georef({ id: '500105', nombre: 'San Carlos' }));
    const r = await resolveLocality({ lat: -33.735, lng: -69.118 }, d);
    expect(r?.id).toBe('lc');
    expect(r?.source).toBe('near');
  });

  it('lejos de todas: Georef nombra el municipio y se crea con su centroide', async () => {
    const d = deps(georef({ id: '500028', nombre: 'Guaymallén' }, { lat: -32.9, lon: -68.79 }));
    const r = await resolveLocality({ lat: -32.8908, lng: -68.8272 }, d);
    expect(r).toEqual({ id: 'nueva', name: 'Guaymallén', source: 'georef', created: true });
    expect(d.insertLocality).toHaveBeenCalledWith({ name: 'Guaymallén', slug: 'guaymallen', lat: -32.9, lng: -68.79 });
  });

  it('Georef nombra una que ya existe (lejos del pin): se usa, no se duplica', async () => {
    const d = deps(georef({ id: '500105', nombre: 'San Carlos' }));
    const r = await resolveLocality({ lat: -33.95, lng: -69.2 }, d);
    expect(r).toEqual({ id: 'sc', name: 'San Carlos', source: 'georef', created: false });
    expect(d.insertLocality).not.toHaveBeenCalled();
  });

  it('sin centroide del municipio, la localidad nueva usa el pin', async () => {
    const d = deps(georef({ id: '500028', nombre: 'Guaymallén' }));
    await resolveLocality({ lat: -32.8908, lng: -68.8272 }, d);
    expect(d.insertLocality).toHaveBeenCalledWith({ name: 'Guaymallén', slug: 'guaymallen', lat: -32.8908, lng: -68.8272 });
  });

  it('Georef caído: la más cercana, marcada fallback para que la revise el superadmin', async () => {
    const down = vi.fn(() => Promise.reject(new Error('timeout'))) as unknown as typeof fetch;
    const d = deps(down);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await resolveLocality({ lat: -32.8908, lng: -68.8272 }, d);
    spy.mockRestore();
    expect(r).toEqual({ id: 'tup', name: 'Tupungato', source: 'fallback', created: false });
    expect(d.insertLocality).not.toHaveBeenCalled();
  });

  it('pin fuera de Argentina (Georef sin provincia): la más cercana, fallback', async () => {
    const d = deps(georef(null));
    const r = await resolveLocality({ lat: -33.45, lng: -70.66 }, d);   // Santiago de Chile
    expect(r?.source).toBe('fallback');
    expect(d.insertLocality).not.toHaveBeenCalled();
  });
});

describe('geo', () => {
  it('slugify', () => {
    expect(slugify('Guaymallén')).toBe('guaymallen');
    expect(slugify('Luján de Cuyo')).toBe('lujan-de-cuyo');
    expect(slugify('  San Rafael ')).toBe('san-rafael');
  });
  it('byDistance ordena del más cercano al más lejano', () => {
    const order = byDistance({ lat: -33.37, lng: -69.15 }, LOCS).map((l) => l.id);
    expect(order[0]).toBe('tup');
    expect(order.at(-1)).toBe('sc');
  });
});
