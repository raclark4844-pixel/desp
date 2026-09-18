import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AP Spartan Lead Engine",
    template: "%s | AP Spartan Lead Engine",
  },
  description: "AP Spartan campaign intake and lead-generation orchestration platform.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
