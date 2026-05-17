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
      {/* Title */}
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
          コードを書いて、街を作れ。
        </div>
        <div style={{ color: "#005500", fontSize: "0.8rem", letterSpacing: "0.1em" }}>
          SEとして必要なスキルが全部身につく学習型オープンワールドゲーム。
        </div>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
        <a
          href="/problems"
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
          ▶ ENTER SYSTEM
        </a>
        <a
          href="/dungeon"
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
          ▷ DUNGEON
        </a>
      </div>

      {/* Category grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "1rem",
          width: "100%",
          maxWidth: "500px",
        }}
      >
        {[
          { label: "SQL", count: "50" },
          { label: "DEBUG", count: "30" },
          { label: "DESIGN", count: "20" },
          { label: "REVIEW", count: "20" },
        ].map(({ label, count }) => (
          <div
            key={label}
            style={{
              border: "1px solid #003300",
              padding: "1rem",
              textAlign: "center",
              background: "rgba(0,15,0,0.6)",
            }}
          >
            <div
              style={{
                fontSize: "1.3rem",
                fontWeight: "bold",
                color: "#00ff41",
                textShadow: "0 0 8px #00ff41",
                letterSpacing: "0.15em",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: "0.7rem",
                color: "#00aa2a",
                marginTop: "0.25rem",
                letterSpacing: "0.1em",
              }}
            >
              {count} MISSIONS
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
