import { initials, venueLogoUrl } from "@/lib/venue-logo";

/**
 * Logo del club. Por defecto (portada del complejo): entero y como se subió,
 * sin recorte ni fondo (respeta la transparencia), dentro de un cuadrado de
 * `size`. Con `round` (tarjeta de la lista, "Lo antes posible"): en un círculo
 * con fondo, el logo entero adentro. Sin logo, las iniciales en un círculo
 * verde sobre lima; `inverse` las invierte (lima sobre verde) para ir encima de
 * un fondo lima. Mismo contraste en claro y oscuro.
 */
export function ClubLogo({ name, logoPath, size = 56, round = false, inverse = false }: {
  name: string; logoPath: string | null | undefined; size?: number; round?: boolean; inverse?: boolean;
}) {
  const url = venueLogoUrl(logoPath);
  const box = { width: size, height: size };
  if (url) {
    return (
      <span style={box} data-testid="logo-club"
        className={`flex shrink-0 items-center justify-center ${round ? 'overflow-hidden rounded-full bg-white p-[3px] ring-1 ring-line' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- archivo chico del bucket público, sin optimizador */}
        <img src={url} alt={`Logo de ${name}`} className={`h-full w-full object-contain ${round ? 'rounded-full' : ''}`} />
      </span>
    );
  }
  return (
    <span
      style={{ ...box, fontSize: size * 0.38 }}
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold
        ${inverse ? 'bg-on-accent text-accent' : 'bg-accent text-on-accent'}`}
      data-testid="logo-club"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
