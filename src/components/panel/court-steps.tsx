/**
 * Cargar una cancha por pasos (diseno/agenda-v2.png, pantalla 3):
 * 1 Datos → 2 Precios → 3 Listo.
 */
const STEPS = ["Datos", "Precios", "Listo"] as const;

export function CourtSteps({ step, title }: { step: 1 | 2 | 3; title: string }) {
  return (
    <header className="mb-5" data-testid="pasos">
      <p className="text-sm text-ink-muted">Paso {step} de 3 · {STEPS[step - 1]}</p>
      <h1 className="text-2xl font-extrabold text-ink">{title}</h1>
      <ol className="mt-3 grid grid-cols-3 gap-2" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i + 1 === step ? "step" : undefined}>
            <span aria-hidden="true" className={`block h-1.5 rounded-full ${i < step ? "bg-primary" : "bg-line"}`} />
            <span className="sr-only">{s}{i + 1 < step ? " (hecho)" : ""}</span>
          </li>
        ))}
      </ol>
    </header>
  );
}

/** Aviso lima con tilde: "Cancha 1 cargada". */
export function CourtLoadedBanner({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="status" data-testid="cancha-cargada" className="mb-5 flex items-center gap-3 rounded-2xl bg-accent px-4 py-3 text-on-accent">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span>
        <span className="block text-base font-extrabold">{title}</span>
        <span className="block text-sm">{detail}</span>
      </span>
    </div>
  );
}
