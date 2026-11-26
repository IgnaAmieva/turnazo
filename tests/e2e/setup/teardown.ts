/** Al terminar la corrida: borra los contadores de S2 que crearon los tests (IPs locales y teléfonos de prueba). */
import { clearTestRateLimits } from "../helpers";

export default async function globalTeardown() {
  await clearTestRateLimits();
}
