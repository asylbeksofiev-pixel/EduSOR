import type { Metadata, Viewport } from "next";
import { Montserrat, Poppins } from "next/font/google";
import "./globals.css";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { ThemeProvider } from "@/components/theme/theme-provider";

const montserrat = Montserrat({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "EduSOR", template: "%s · EduSOR" },
  description: "EduSOR — современная школьная платформа для СОР и СОЧ с проверкой через Google Gemini AI",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f9" },
    { media: "(prefers-color-scheme: dark)", color: "#080d1a" },
  ],
};

const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('edusor_theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale} className={`${montserrat.variable} ${poppins.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="relative min-h-dvh antialiased selection:bg-primary-soft selection:text-primary">
        {/* Soft Plasmamorphism ambient canvas behind Liquid Glass surfaces */}
        <div className="plasma-canvas no-print" aria-hidden="true">
          <div className="plasma-orb plasma-orb-1" />
          <div className="plasma-orb plasma-orb-2" />
          <div className="plasma-orb plasma-orb-3" />
        </div>
        <ThemeProvider>
          <I18nProvider locale={locale}>
            <div className="relative z-10 flex min-h-dvh flex-col">{children}</div>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
