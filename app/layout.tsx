import type { Metadata } from "next";
import { Bricolage_Grotesque, Courier_Prime, Karla } from "next/font/google";

import { SiteFooter, SiteHeader } from "./chrome";
import "./globals.css";

/*
 * Type.
 *
 * Bricolage Grotesque is deliberately a little awkward — the flat-topped 'a',
 * the odd 'g'. Set heavy and tight it reads as a hand-lettered noticeboard
 * header rather than a corporate display face.
 *
 * Courier Prime is a real typewriter face, and it is doing the most work of the
 * three: every timestamp, nickname and label is "typed", which is what sells
 * cheap print without a single texture image.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const karla = Karla({
  variable: "--font-karla",
  subsets: ["latin"],
  display: "swap",
});

const courier = Courier_Prime({
  variable: "--font-courier",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Social Aachen Website: someone is still awake",
  description:
    "An anonymous noticeboard for Indonesians in Aachen. Write anything; it deletes itself after 24 hours. Video call whoever is online. No sign-up.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${karla.variable} ${courier.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {/* Paper grain. Decorative, fixed, never interactive. */}
        <div
          aria-hidden="true"
          className="grain pointer-events-none fixed inset-0 z-50"
        />

        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
