import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// SHA-256 hash of your passphrase — replace this with your own.
// To generate: https://emn178.github.io/online-tools/sha256.html
// or in browser console: crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourpassphrase'))
//   .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
const PASSPHRASE_HASH = "6bc5cc5cb7a9e155898d952d3f9a92ed026a45657da262fed553fe9e2b3aa686";

async function checkPassphrase(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("") === PASSPHRASE_HASH;
}

function Gate({ children }) {
  const stored = sessionStorage.getItem("cabinet_auth");
  const [authed, setAuthed] = useState(stored === PASSPHRASE_HASH);
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(false);

  // If no hash set, skip gate
  if (PASSPHRASE_HASH === "REPLACE_WITH_YOUR_HASH" || authed) return children;

  const attempt = async () => {
    if (checking) return;
    setChecking(true);
    const ok = await checkPassphrase(input.trim());
    setChecking(false);
    if (ok) {
      sessionStorage.setItem("cabinet_auth", PASSPHRASE_HASH);
      setAuthed(true);
    } else {
      setShake(true);
      setInput("");
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0d1117", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{
        textAlign: "center", padding: "40px 32px", borderRadius: 16,
        background: "#161b27", border: "1px solid rgba(201,169,110,0.2)",
        boxShadow: "0 12px 48px rgba(0,0,0,0.4)", minWidth: 280,
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🍸</div>
        <div style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 22, color: "#c9a96e", marginBottom: 8, letterSpacing: 1,
        }}>The Cabinet</div>
        <div style={{ fontSize: 12, color: "#7a6a50", marginBottom: 24, letterSpacing: 1 }}>
          ENTER PASSPHRASE
        </div>
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && attempt()}
          autoFocus
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10,
            border: "1px solid rgba(201,169,110,0.3)",
            background: "rgba(255,255,255,0.05)", color: "#f0e6d3",
            fontSize: 14, fontFamily: "inherit", outline: "none",
            textAlign: "center", letterSpacing: 3,
            animation: shake ? "shake 0.5s ease" : "none",
          }}
        />
        <button onClick={attempt} disabled={checking} style={{
          marginTop: 14, width: "100%", padding: "10px",
          borderRadius: 10, border: "1px solid rgba(201,169,110,0.4)",
          background: "rgba(201,169,110,0.1)", color: "#c9a96e",
          fontSize: 13, fontFamily: "inherit", cursor: "pointer", letterSpacing: 1,
          opacity: checking ? 0.6 : 1,
        }}>{checking ? "…" : "Enter"}</button>
      </div>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Gate>
      <App />
    </Gate>
  </StrictMode>
);
