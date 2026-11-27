/**
 * Las 3 historias (1080×1920) para next/og (satori): solo flexbox y estilos en
 * línea. Los colores son los de la paleta de globals.css (satori no lee
 * variables CSS). Diseño: diseno/historias.png (fuera del repo).
 * Alturas calculadas para que con 6 turnos y un nombre de 2 líneas todo entre.
 */
import type { StoryData, StoryStyle } from '@/lib/stories';

export const C = {
  green: '#0B3D2E',
  green2: '#14523F',
  line: '#2A6B55',
  lime: '#D4F34A',
  cream: '#F6F3EA',
  creamMuted: '#B9C9BF',
  ink: '#14201B',
  inkMuted: '#5C6B63',
  white: '#FFFFFF',
  border: '#E3E8E2',
};

const money = (n: number) => `$${n.toLocaleString('es-AR')}`;

/** Logo del club en un círculo blanco; sin logo, las iniciales. */
function Logo({ data, bg, fg, size = 190 }: { data: StoryData; bg: string; fg: string; size?: number }) {
  if (data.logo) {
    // Entero y como se subió: sin recorte ni fondo (respeta la transparencia)
    return (
      <div style={{ width: size, height: size, minWidth: size, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori (next/og) solo acepta <img> */}
        <img src={data.logo} width={size} height={size} style={{ objectFit: 'contain' }} alt="" />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, minWidth: size, borderRadius: size, background: bg, color: fg, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 800, letterSpacing: -2,
    }}>
      {data.initials}
    </div>
  );
}

/** Logo + nombre del club + localidad. */
function Header({ data, logoBg, logoFg, color, muted }: { data: StoryData; logoBg: string; logoFg: string; color: string; muted: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
      <Logo data={data} bg={logoBg} fg={logoFg} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, color }}>
        <span style={{ fontSize: 62, fontWeight: 800, lineHeight: 1.05 }}>{data.venueName}</span>
        <span style={{ fontSize: 42, color: muted, marginTop: 6 }}>{data.localityName}</span>
      </div>
    </div>
  );
}

/** Deporte bien visible: pastilla grande con el nombre en mayúsculas. */
function SportBadge({ name, bg, fg }: { name: string; bg: string; fg: string }) {
  return (
    <div style={{
      display: 'flex', alignSelf: 'flex-start', background: bg, color: fg, borderRadius: 999,
      padding: '14px 40px', fontSize: 60, fontWeight: 800, letterSpacing: 4,
    }}>
      {name.toUpperCase()}
    </div>
  );
}

/**
 * Marca Depoturnos (diseno/marca): pin + "depo" (500) + "turnos" (800).
 * Sobre fondo claro: pin verde lleno y texto verde. Sobre fondo oscuro: pin de
 * contorno lima, "depo" crema y "turnos" lima.
 */
function Brand({ dark }: { dark: boolean }) {
  const depo = dark ? C.cream : C.green;
  const turnos = dark ? C.lime : C.green;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 50, flexShrink: 0 }}>
      <svg width="46" height="57" viewBox="10 1 76 94">
        <path d="M48 92 C22 62 14 50 14 38 A34 34 0 0 1 82 38 C82 50 74 62 48 92 Z"
          fill={dark ? 'none' : C.green} stroke={dark ? C.lime : C.green} strokeWidth="5" strokeLinejoin="round" />
        <circle cx="48" cy="38" r="20" fill={C.lime} />
        <path d="M34 28 Q46 38 34 48 M62 28 Q50 38 62 48" stroke={C.green} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      </svg>
      <span style={{ display: 'flex' }}>
        <span style={{ fontWeight: 500, color: depo }}>depo</span>
        <span style={{ fontWeight: 800, color: turnos }}>turnos</span>
      </span>
    </div>
  );
}

function FieldLines({ color }: { color: string }) {
  return (
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: 'absolute', top: 0, left: 0 }}>
      <g fill="none" stroke={color} strokeWidth="6">
        <rect x="60" y="60" width="960" height="1800" />
        <path d="M60 960H1020" />
        <circle cx="540" cy="960" r="170" />
        <rect x="300" y="60" width="480" height="280" />
        <rect x="300" y="1580" width="480" height="280" />
      </g>
    </svg>
  );
}

function Empty({ color }: { color: string }) {
  return <div style={{ display: 'flex', fontSize: 56, color, marginTop: 40 }}>No quedan turnos libres este día.</div>;
}

export function StoryArt({ data, style, link }: { data: StoryData; style: StoryStyle; link: string }) {
  const base = {
    width: 1080, height: 1920, display: 'flex', flexDirection: 'column' as const,
    fontFamily: 'Outfit', position: 'relative' as const, padding: '100px 96px 90px', overflow: 'hidden' as const,
  };

  if (style === 'invitacion') {
    return (
      <div style={{ ...base, background: C.cream, color: C.ink }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Logo data={data} bg={C.green} fg={C.lime} size={170} />
          <SportBadge name={data.sport.name} bg={C.lime} fg={C.green} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 60, fontSize: 124, fontWeight: 800, lineHeight: 1.02, color: C.green, letterSpacing: -3 }}>
          <span>¿Armamos</span><span>un partido?</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 46, marginTop: 24 }}>
          <span style={{ color: C.inkMuted }}>{data.venueName} tiene lugar</span>
          <span style={{ color: C.ink, fontWeight: 800 }}>{data.dayLabel.replace('Hoy · ', 'hoy, ')}</span>
        </div>
        {data.slots.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, marginTop: 44 }}>
            {data.slots.map((s) => (
              <div key={s.time} style={{
                width: 430, height: 186, background: C.white, border: `3px solid ${C.border}`, borderRadius: 44,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 88, fontWeight: 800, color: C.ink, lineHeight: 1 }}>{s.time}</span>
                <span style={{ fontSize: 40, color: C.inkMuted, marginTop: 8 }}>{money(s.price)}</span>
              </div>
            ))}
          </div>
        ) : <Empty color={C.inkMuted} />}
        <div style={{ display: 'flex', flexGrow: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, background: C.green, color: C.cream, borderRadius: 52, padding: '36px 50px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <span style={{ fontSize: 38, color: C.creamMuted }}>Reservá sin llamar</span>
            <span style={{ fontSize: 46, fontWeight: 800 }}>{link}</span>
          </div>
          <span style={{ fontSize: 76, color: C.lime }}>→</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 36 }}>
          <Brand dark={false} />
        </div>
      </div>
    );
  }

  if (style === 'urgencia') {
    return (
      <div style={{ ...base, background: C.lime, color: C.green }}>
        {/* Pin grande de fondo */}
        <svg width="900" height="1200" viewBox="0 0 24 32" style={{ position: 'absolute', right: -280, top: 420, opacity: 0.1 }}>
          <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0Zm0 17a5.3 5.3 0 1 1 0-10.6A5.3 5.3 0 0 1 12 17Z" fill={C.green} />
        </svg>
        <Header data={data} logoBg={C.green} logoFg={C.lime} color={C.green} muted={C.green} />
        <div style={{ display: 'flex', marginTop: 50 }}><SportBadge name={data.sport.name} bg={C.green} fg={C.lime} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40, fontSize: 196, fontWeight: 800, lineHeight: 0.92, letterSpacing: -6 }}>
          <span>QUEDAN</span><span>LUGARES</span>
        </div>
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, marginTop: 44 }}>
          {data.dayLabel}{data.minPrice !== null ? ` · desde ${money(data.minPrice)}` : ''}
        </div>
        {data.slots.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 40, width: 888 }}>
            {data.slots.map((s) => (
              <div key={s.time} style={{ display: 'flex', background: C.green, color: C.lime, borderRadius: 999, padding: '24px 46px', fontSize: 76, fontWeight: 800 }}>
                {s.time}
              </div>
            ))}
          </div>
        ) : <Empty color={C.green} />}
        <div style={{ display: 'flex', flexGrow: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 44, fontWeight: 800 }}>
          <span>Reservá en</span><span>{link}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <Brand dark={false} />
        </div>
      </div>
    );
  }

  // Pizarra
  return (
    <div style={{ ...base, background: C.green, color: C.cream }}>
      <FieldLines color={C.cream} opacity={0.13} />
      <Header data={data} logoBg={C.cream} logoFg={C.green} color={C.cream} muted={C.creamMuted} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 50 }}>
        <SportBadge name={data.sport.name} bg={C.lime} fg={C.green} />
      </div>
      <div style={{ display: 'flex', fontSize: 48, fontWeight: 800, color: C.lime, marginTop: 44, letterSpacing: 2 }}>
        {data.dayLabel.toUpperCase()}
      </div>
      <div style={{ display: 'flex', fontSize: 124, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3, marginTop: 6 }}>
        Turnos libres
      </div>
      {data.slots.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 40 }}>
          {data.slots.map((s) => (
            <div key={s.time} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: C.lime, color: C.green, borderRadius: 36, padding: '16px 52px', height: 112,
            }}>
              <span style={{ fontSize: 76, fontWeight: 800 }}>{s.time}</span>
              <span style={{ fontSize: 50, fontWeight: 800 }}>{money(s.price)}</span>
            </div>
          ))}
        </div>
      ) : <Empty color={C.creamMuted} />}
      <div style={{ display: 'flex', flexGrow: 1 }} />
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, borderTop: `3px solid ${C.line}`, paddingTop: 36 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ fontSize: 38, color: C.creamMuted }}>Reservá en 1 minuto</span>
          <span style={{ fontSize: 44, fontWeight: 800 }}>{link}</span>
        </div>
        <Brand dark />
      </div>
    </div>
  );
}
