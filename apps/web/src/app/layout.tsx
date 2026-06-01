import type { Metadata } from "next"
import MatrixRain from "../components/MatrixRain"
import NavHeader from "../components/NavHeader"
import { I18nProvider } from "../i18n"
import "./globals.css"

export const metadata: Metadata = {
  title: "BANG BANG",
  description: "純粋なオンラインFPS。— BATTLE · RANK · SURVIVE",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        style={{
          height: "100dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#000000",
          fontFamily: "monospace",
        }}
      >
        <I18nProvider>
          <MatrixRain />
          <NavHeader />
          <main
            style={{ flex: 1, overflow: "auto", minHeight: 0, position: "relative", zIndex: 1 }}
          >
            {children}
          </main>
        </I18nProvider>
      </body>
    </html>
  )
}
