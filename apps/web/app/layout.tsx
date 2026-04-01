import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "CollabCode AI",
  description: "Hackathon MVP for collaborative coding with AI review.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
