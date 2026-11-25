/**
 * Formas de pago que ofrece un complejo para un turno. La usan la página
 * /reservar y la hoja de reserva del complejo. Los montos son orientativos:
 * el monto real lo calcula create_booking_hold en la base.
 */

export type PaymentOption = {
  value: 'deposit' | 'full' | 'venue';
  label: string;
  detail: string;
  /** Monto orientativo (el real lo calcula la base); null si no hay precio */
  amount: number | null;
};

export type VenuePaymentConfig = {
  deposit_required: boolean;
  deposit_type: 'fixed' | 'percent' | null;
  deposit_value: number | null;
  allow_full_payment: boolean;
  allow_pay_at_venue: boolean;
};

export function buildPaymentOptions(venue: VenuePaymentConfig, price: number | null): PaymentOption[] {
  const options: PaymentOption[] = [];
  if (venue.deposit_required) {
    let depositAmount: number | null = null;
    if (price !== null && venue.deposit_value !== null) {
      depositAmount = venue.deposit_type === 'percent'
        ? Math.round(price * venue.deposit_value / 100)
        : Math.min(venue.deposit_value, price);
    }
    options.push({
      value: 'deposit',
      label: 'Pagar la seña online',
      detail: 'El resto lo pagás en el lugar.',
      amount: depositAmount,
    });
  }
  if (venue.allow_full_payment) {
    options.push({
      value: 'full',
      label: 'Pagar el total online',
      detail: 'Pagás todo ahora con Mercado Pago.',
      amount: price,
    });
  }
  if (venue.allow_pay_at_venue) {
    options.push({
      value: 'venue',
      label: 'Pagar en el lugar',
      detail: 'Reservás ahora y pagás cuando vas a jugar.',
      amount: price,
    });
  }
  return options;
}
