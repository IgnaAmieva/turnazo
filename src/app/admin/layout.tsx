import type { Metadata } from 'next';
import PanelNav from '@/app/panel/_nav';
import SavedToast from '@/components/panel/saved-toast';
import { requireSuperadmin } from '@/lib/supabase/admin-queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Superadmin', robots: { index: false } };

/** Solo superadmin: sin sesión → login; con sesión de dueño → 404. La base lo vuelve a verificar en cada consulta. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSuperadmin();
  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-bg text-ink">
      <PanelNav email={user.email ?? ''} isSuperadmin />
      <main className="flex-1 min-w-0 overflow-auto p-4 md:p-6">{children}</main>
      <SavedToast />
    </div>
  );
}
