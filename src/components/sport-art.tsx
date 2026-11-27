/**
 * Dibujos de línea de los deportes (sin emojis): ícono chico para las
 * tarjetas y líneas de cancha de fondo para portadas. Usan currentColor.
 */

type IconProps = { slug: string; className?: string };

/** Ícono de línea del deporte (24 × 24). */
export function SportIcon({ slug, className = 'h-7 w-7' }: IconProps) {
  const common = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className,
  };
  if (slug === 'futbol') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 7.5 3.3 2.4-1.3 3.9h-4l-1.3-3.9L12 7.5Z" />
        <path d="M12 7.5V3.2M15.3 9.9l4.1-1.4M14 13.8l2.5 3.5M10 13.8l-2.5 3.5M8.7 9.9 4.6 8.5" />
      </svg>
    );
  }
  if (slug === 'padel') {
    return (
      <svg {...common}>
        <path d="M14.5 3.5a6 6 0 0 1 0 8.5l-2.8 2.8a2 2 0 0 1-2.8 0L7.2 13a2 2 0 0 1 0-2.8L10 7.4a6 6 0 0 1 4.5-3.9Z" />
        <path d="m8.3 14.8-4.6 4.6a1.4 1.4 0 0 0 2 2l4.5-4.6" />
        <circle cx="12.5" cy="7.5" r=".6" fill="currentColor" />
        <circle cx="14.6" cy="9.4" r=".6" fill="currentColor" />
        <circle cx="11.2" cy="10" r=".6" fill="currentColor" />
        <circle cx="19.5" cy="19.5" r="1.8" />
      </svg>
    );
  }
  if (slug === 'tenis') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

/**
 * Líneas de cancha para el fondo de una portada (horizontal, se recorta
 * para cubrir). En claro: el color del contenedor con la opacidad que pase
 * quien la usa. En oscuro (.court-lines en globals.css): blanco crema #F6F3EA
 * al 13%, para que la portada no se vea toda verde.
 */
export function CourtLines({ slug, className = '' }: IconProps) {
  const common = {
    viewBox: '0 0 400 200', preserveAspectRatio: 'xMidYMid slice', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true,
    className: `court-lines pointer-events-none absolute inset-0 h-full w-full ${className}`,
  };
  if (slug === 'futbol') {
    return (
      <svg {...common}>
        <rect x="10" y="10" width="380" height="180" />
        <path d="M200 10v180" />
        <circle cx="200" cy="100" r="32" />
        <rect x="10" y="55" width="50" height="90" />
        <rect x="340" y="55" width="50" height="90" />
      </svg>
    );
  }
  if (slug === 'tenis') {
    return (
      <svg {...common}>
        <rect x="10" y="10" width="380" height="180" />
        <path d="M10 32h380M10 168h380M200 10v180M95 32v136M305 32v136M95 100h210" />
      </svg>
    );
  }
  // Pádel (y cualquier otro): rectángulo, red al medio, líneas de saque
  return (
    <svg {...common}>
      <rect x="10" y="10" width="380" height="180" />
      <path d="M200 10v180M80 10v180M320 10v180M80 100h240" />
    </svg>
  );
}
