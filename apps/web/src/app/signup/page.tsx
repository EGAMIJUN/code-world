"use client"

import { useState } from "react"
import { authClient } from "../../lib/auth-client"

export default function SignupPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name,
        callbackURL: "/world",
      })
      if (result.error) {
        setError(result.error.message ?? "REGISTRATION FAILED")
      }
    } catch {
      setError("REGISTRATION FAILED")
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
            CREATE NEW PLAYER ACCOUNT
          </div>
        </div>

        {/* Signup box */}
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
            ▓ REGISTER ▓
          </div>

          <form
            onSubmit={handleSignup}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <input
              type="text"
              placeholder="DISPLAY NAME"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={inputStyle}
            />
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
              placeholder="PASSWORD (8+ CHARS)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
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
              {loading ? "⟳ CREATING ACCOUNT..." : "▶ CREATE ACCOUNT"}
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
            ALREADY REGISTERED?{" "}
            <a href="/login" style={{ color: "#00aa2a", textDecoration: "none" }}>
              LOGIN →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
