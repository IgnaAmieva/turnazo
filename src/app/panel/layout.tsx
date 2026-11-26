import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PanelNav from './_nav';
import { isSuperadmin } from '@/lib/supabase/admin-queries';
import PwaInstallGuide from '@/components/panel/pwa-install-guide';
import ServiceWorkerRegistrar from '@/components/panel/service-worker-registrar';
import SavedToast from '@/components/panel/saved-toast';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');
  const superadmin = await isSuperadmin(supabase);

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-bg text-ink">
      <PanelNav email={user.email ?? ''} isSuperadmin={superadmin} />
      <main className="flex-1 min-w-0 overflow-auto p-4 md:p-6">
        {children}
      </main>
      <PwaInstallGuide />
      <ServiceWorkerRegistrar />
      <SavedToast />
    </div>
  );
}
