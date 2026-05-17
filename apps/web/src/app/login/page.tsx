"use client"

import { useState } from "react"
import { signIn } from "../../lib/auth-client"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleGitHubLogin = async () => {
    await signIn.social({ provider: "github", callbackURL: "/world" })
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await signIn.email({ email, password, callbackURL: "/world" })
      if (result.error) {
        setError(result.error.message ?? "LOGIN FAILED")
      }
    } catch {
      setError("LOGIN FAILED")
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#001100",
    border: "1px solid #003300",
    color: "#00ff41",
    padding: "0.6rem 0.75rem",
    fontSize: "0.85rem",
    fontFamily: "monospace",
    outline: "none",
    boxSizing: "border-box",
  }

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "monospace",
        color: "#00ff41",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
        }}
      >
        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: "bold",
              letterSpacing: "0.3em",
              color: "#00ff41",
              textShadow: "0 0 20px #00ff41",
              marginBottom: "0.5rem",
            }}
          >
            ⚡ CODE WORLD
          </div>
          <div style={{ fontSize: "0.75rem", color: "#00aa2a", letterSpacing: "0.2em" }}>
            AUTHENTICATE TO ACCESS SYSTEM
          </div>
        </div>

        {/* Login box */}
        <div
          style={{
            border: "1px solid #003300",
            padding: "1.5rem",
            background: "rgba(0,10,0,0.8)",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <div
            style={{
              textAlign: "center",
              fontSize: "0.75rem",
              letterSpacing: "0.2em",
              color: "#00aa2a",
              marginBottom: "0.25rem",
            }}
          >
            ▓ LOGIN ▓
          </div>

          {/* GitHub OAuth */}
          <button
            type="button"
            onClick={handleGitHubLogin}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.75rem",
              background: "transparent",
              border: "1px solid #003300",
              color: "#00ff41",
              padding: "0.65rem 1rem",
              fontFamily: "monospace",
              fontSize: "0.8rem",
              letterSpacing: "0.15em",
              cursor: "pointer",
              width: "100%",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
            GITHUB LOGIN
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              color: "#003300",
              fontSize: "0.7rem",
              letterSpacing: "0.1em",
            }}
          >
            <div style={{ flex: 1, height: "1px", background: "#003300" }} />
            <span style={{ color: "#005500" }}>OR</span>
            <div style={{ flex: 1, height: "1px", background: "#003300" }} />
          </div>

          {/* Email / Password */}
          <form
            onSubmit={handleEmailLogin}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <input
              type="email"
              placeholder="EMAIL ADDRESS"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="PASSWORD"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
            {error && (
              <div style={{ fontSize: "0.75rem", color: "#ff0040", letterSpacing: "0.1em" }}>
                ✗ {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                background: loading ? "#001100" : "#003300",
                color: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.6rem 1rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                letterSpacing: "0.2em",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                textShadow: loading ? "none" : "0 0 8px #00ff41",
                marginTop: "0.25rem",
              }}
            >
              {loading ? "⟳ AUTHENTICATING..." : "▶ LOGIN"}
            </button>
          </form>

          <div
            style={{
              textAlign: "center",
              fontSize: "0.7rem",
              color: "#005500",
              letterSpacing: "0.1em",
            }}
          >
            NO ACCOUNT?{" "}
            <a href="/signup" style={{ color: "#00aa2a", textDecoration: "none" }}>
              REGISTER →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
