/**
 * Marca Depoturnos (diseno/marca): el pin con la pelota + "depo" (Outfit 500)
 * y "turnos" (Outfit 800). Armado como componente (no el SVG con <text>):
 *   - claro: pin verde lleno, pelota lima, texto verde;
 *   - oscuro: pin de contorno lima, pelota lima, "depo" crema y "turnos" lima.
 * Los colores salen de las variables del tema (--brand, --primary, --accent y
 * --logo-pin-fill), así sigue al modo claro/oscuro sin JavaScript.
 * En pantallas muy angostas (< 360 px) queda solo el pin; el nombre sigue
 * estando para los lectores de pantalla.
 */

/** El pin de la marca (mismas coordenadas que diseno/marca/*.svg). */
export function BrandPin({ className = '', size = 28 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="10 1 76 94" width={size * (76 / 94)} height={size} aria-hidden="true" className={`shrink-0 ${className}`}
      data-testid="marca-pin">
      <path d="M48 92 C22 62 14 50 14 38 A34 34 0 0 1 82 38 C82 50 74 62 48 92 Z"
        fill="var(--logo-pin-fill)" stroke="var(--primary)" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="48" cy="38" r="20" fill="var(--accent)" />
      <path d="M34 28 Q46 38 34 48 M62 28 Q50 38 62 48" stroke="#0B3D2E" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Pin + "depo" + "turnos". `size` es el alto del pin en px; el texto acompaña. */
export function BrandLogo({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} data-testid="marca">
      <BrandPin size={size} />
      <span className="leading-none tracking-tight max-[359px]:sr-only" style={{ fontSize: Math.round(size * 0.74) }}>
        <span className="font-medium text-brand">depo</span>
        <span className="font-extrabold text-primary">turnos</span>
      </span>
    </span>
  );
}
