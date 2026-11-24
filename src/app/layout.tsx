import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/constants";
import { THEME_BAR_COLORS, THEME_SCRIPT } from "@/lib/theme";

const outfit = Outfit({ subsets: ["latin"], weight: ["500", "800"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
  description: "Reservá tu cancha de pádel, fútbol o tenis en el Valle de Uco.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_NAME },
};

export const viewport: Viewport = {
  // El script del tema los pisa con el modo elegido; esto es sin JavaScript.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_BAR_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_BAR_COLORS.dark },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme lo pone el script antes de hidratar: no es un error de hidratación.
    <html lang="es" className={`${outfit.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full bg-bg text-ink font-sans font-medium antialiased">
        {children}
      </body>
    </html>
  );
}
