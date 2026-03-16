import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Independent Doors — Plan Analyser",
  description: "AI-powered door detection from building plans",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f8f9fa]">{children}</body>
    </html>
  );
}
