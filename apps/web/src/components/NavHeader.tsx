"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useI18n } from "../i18n"
import LocaleSwitcher from "./LocaleSwitcher"

export default function NavHeader() {
  const pathname = usePathname()
  const { t } = useI18n()

  const links = [
    { href: "/world", label: t.nav.play },
    { href: "/leaderboard", label: t.nav.ranking },
    { href: "/profile", label: t.nav.profile },
  ]

  return (
    <header
      style={{
        flexShrink: 0,
        borderBottom: "1px solid #003300",
        background: "rgba(0,0,0,0.95)",
        backdropFilter: "blur(4px)",
        zIndex: 50,
        fontFamily: "monospace",
        position: "relative",
      }}
    >
      <div
        style={{
          margin: "0 auto",
          maxWidth: "1280px",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
          padding: "0.6rem 1rem",
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontWeight: "bold",
            color: "#00ff41",
            letterSpacing: "0.2em",
            fontSize: "0.85rem",
            textDecoration: "none",
            whiteSpace: "nowrap",
            textShadow: "0 0 10px #00ff41",
          }}
        >
          鉄火 TEKKA
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: "0.25rem", flex: 1 }}>
          {links.map((link) => {
            const isActive = pathname.startsWith(link.href) && link.href !== "/"
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "0.3rem 0.75rem",
                  fontSize: "0.75rem",
                  letterSpacing: "0.15em",
                  textDecoration: "none",
                  color: isActive ? "#00ff41" : "#00aa2a",
                  border: isActive ? "1px solid #003300" : "1px solid transparent",
                  background: isActive ? "rgba(0,255,65,0.08)" : "transparent",
                  textShadow: isActive ? "0 0 8px #00ff41" : "none",
                  transition: "all 0.2s",
                }}
              >
                {isActive ? `[${link.label}]` : link.label}
              </Link>
            )
          })}
        </nav>

        <LocaleSwitcher />
      </div>
    </header>
  )
}
