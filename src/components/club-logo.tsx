import { initials, venueLogoUrl } from "@/lib/venue-logo";

/**
 * Logo del club (portada del complejo). Entero y como se subió: sin recorte,
 * sin fondo (respeta la transparencia), dentro de un cuadrado de `size`. Sin
 * logo, las iniciales en un círculo verde sobre lima (mismo contraste en claro
 * y oscuro).
 */
export function ClubLogo({ name, logoPath, size = 56 }: { name: string; logoPath: string | null | undefined; size?: number }) {
  const url = venueLogoUrl(logoPath);
  const box = { width: size, height: size };
  if (url) {
    return (
      <span style={box} className="flex shrink-0 items-center justify-center" data-testid="logo-club">
        {/* eslint-disable-next-line @next/next/no-img-element -- archivo chico del bucket público, sin optimizador */}
        <img src={url} alt={`Logo de ${name}`} className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      style={{ ...box, fontSize: size * 0.38 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent font-extrabold text-on-accent"
      data-testid="logo-club"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
