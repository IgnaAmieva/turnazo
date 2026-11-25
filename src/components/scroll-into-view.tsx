'use client';

import { useEffect, useRef } from 'react';

/** Lleva a la vista (sin mover la página) el elemento que la contiene: el día elegido en la fila deslizable. */
export function ScrollIntoViewOnMount() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);
  return <span ref={ref} hidden />;
}
