export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2rem",
        padding: "2rem",
        fontFamily: "monospace",
        color: "#00ff41",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: "clamp(2rem, 6vw, 3.5rem)",
            fontWeight: "bold",
            letterSpacing: "0.3em",
            color: "#00ff41",
            textShadow: "0 0 20px #00ff41, 0 0 40px #00ff41",
            marginBottom: "0.75rem",
          }}
        >
          ▓▓ CODE WORLD ▓▓
        </div>
        <div
          style={{
            color: "#00aa2a",
            fontSize: "0.95rem",
            letterSpacing: "0.2em",
            marginBottom: "0.4rem",
          }}
        >
          純粋なオンラインFPS。
        </div>
        <div style={{ color: "#005500", fontSize: "0.8rem", letterSpacing: "0.1em" }}>
          BATTLE · RANK · SURVIVE
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
        <a
          href="/world"
          style={{
            color: "#00ff41",
            border: "1px solid #00ff41",
            padding: "0.75rem 2.5rem",
            textDecoration: "none",
            letterSpacing: "0.2em",
            fontSize: "0.9rem",
            textShadow: "0 0 8px #00ff41",
            boxShadow: "0 0 15px rgba(0,255,65,0.2)",
            background: "rgba(0,255,65,0.05)",
          }}
        >
          ▶ PLAY
        </a>
        <a
          href="/leaderboard"
          style={{
            color: "#00aa2a",
            border: "1px solid #003300",
            padding: "0.75rem 2.5rem",
            textDecoration: "none",
            letterSpacing: "0.2em",
            fontSize: "0.9rem",
            background: "rgba(0,20,0,0.5)",
          }}
        >
          ▷ RANKING
        </a>
      </div>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          fontSize: "0.75rem",
          letterSpacing: "0.15em",
        }}
      >
        <a
          href="/login"
          style={{
            color: "#005500",
            textDecoration: "none",
            borderBottom: "1px dashed #003300",
          }}
        >
          LOGIN
        </a>
        <a
          href="/signup"
          style={{
            color: "#005500",
            textDecoration: "none",
            borderBottom: "1px dashed #003300",
          }}
        >
          REGISTER
        </a>
      </div>
    </div>
  )
}
