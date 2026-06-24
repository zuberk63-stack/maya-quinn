import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maya Quinn Finance Automation",
  description: "Fact-grounded finance content automation system"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
