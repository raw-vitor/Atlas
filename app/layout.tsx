import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Provider } from "@/components/ui/provider";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atlas · Gerador de R2",
  description: "Envie a carteira e a transcrição da R1. O Atlas devolve o deck da R2.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`light ${geist.variable}`} style={{ colorScheme: "light" }}>
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
