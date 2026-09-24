import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { BRAND_NAME } from "@rushsite/shared";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { ChallengeInbox } from "@/components/challenges/ChallengeInbox";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { InviteInbox } from "@/components/friends/InviteInbox";
import { NotifyListener } from "@/components/notify/NotifyListener";
import { ToastProvider } from "@/components/ui/Toast";
import { SessionProvider } from "@/lib/session";
import { PREFS_BOOT_SCRIPT } from "@/lib/prefs-boot";
import "@/styles/globals.css";

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Makes Open Graph image URLs absolute
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3107"),
  title: { default: BRAND_NAME, template: `%s | ${BRAND_NAME}` },
  description: "Competitive 1v1 Aim, 2v2 Aim and 3v3 Rush for CS2. Queue, climb the ladder, enter cups.",
};

export const viewport: Viewport = {
  themeColor: "#0f0e13",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SessionProvider>
          <ToastProvider>
            <SiteHeader />
            <AnnouncementBanner />
            <ChallengeInbox />
            <InviteInbox />
            <NotifyListener />
            <main id="main">{children}</main>
            <SiteFooter />
            <ChatSidebar />
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
