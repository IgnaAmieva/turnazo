import { APP_NAME } from "@/lib/constants";
import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bg-surface border-b border-line sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/" className="text-brand font-extrabold text-xl tracking-tight min-h-11 flex items-center">
            {APP_NAME}
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="bg-bg text-ink min-h-[calc(100dvh-3.5rem)]">
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </div>
    </>
  );
}
