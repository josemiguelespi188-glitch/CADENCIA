import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/context";
import { AuthProvider } from "@/lib/auth-context";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Cadencia",
  description: "Plan your training, sync real data from Strava, WHOOP and Garmin, and train with purpose.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-ink">
        {/* Runs before paint — reads the saved theme and sets data-theme before hydration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('cadencia-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}`,
          }}
        />
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
