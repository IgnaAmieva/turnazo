import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PanelNav from './_nav';
import PwaInstallGuide from '@/components/panel/pwa-install-guide';
import ServiceWorkerRegistrar from '@/components/panel/service-worker-registrar';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-bg text-ink">
      <PanelNav email={user.email ?? ''} />
      <main className="flex-1 min-w-0 overflow-auto p-4 md:p-6">
        {children}
      </main>
      <PwaInstallGuide />
      <ServiceWorkerRegistrar />
    </div>
  );
}
