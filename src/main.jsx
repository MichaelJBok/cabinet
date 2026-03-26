import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { supabase } from "./lib/supabase";

function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const sendMagicLink = async () => {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false }, // only allow existing users
    });
    setSending(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  };

  // Loading
  if (session === undefined) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#0d1117",
      }}>
        <div style={{ color: "#c9a96e", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>
          Loading…
        </div>
      </div>
    );
  }

  // Authenticated
  if (session) return children;

  // Sign in screen
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0d1117", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{
        textAlign: "center", padding: "40px 32px", borderRadius: 16,
        background: "#161b27", border: "1px solid rgba(201,169,110,0.2)",
        boxShadow: "0 12px 48px rgba(0,0,0,0.4)", minWidth: 300, maxWidth: 360,
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🍸</div>
        <div style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 22, color: "#c9a96e", marginBottom: 8, letterSpacing: 1,
        }}>The Cabinet</div>

        {!sent ? (
          <>
            <div style={{ fontSize: 12, color: "#7a6a50", marginBottom: 24, letterSpacing: 1 }}>
              ENTER YOUR EMAIL
            </div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMagicLink()}
              placeholder="you@example.com"
              autoFocus
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: "1px solid rgba(201,169,110,0.3)",
                background: "rgba(255,255,255,0.05)", color: "#f0e6d3",
                fontSize: 14, fontFamily: "inherit", outline: "none",
                textAlign: "center", boxSizing: "border-box",
              }}
            />
            {error && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#ff8080" }}>
                {error.includes("Signups not allowed") ? "That email isn't registered. Ask Michael for access." : error}
              </div>
            )}
            <button
              onClick={sendMagicLink}
              disabled={sending || !email.trim()}
              style={{
                marginTop: 14, width: "100%", padding: "10px",
                borderRadius: 10, border: "1px solid rgba(201,169,110,0.4)",
                background: "rgba(201,169,110,0.1)", color: "#c9a96e",
                fontSize: 13, fontFamily: "inherit", cursor: "pointer",
                letterSpacing: 1, opacity: (!email.trim() || sending) ? 0.5 : 1,
              }}
            >
              {sending ? "Sending…" : "Send Magic Link"}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📬</div>
            <div style={{ fontSize: 14, color: "#c9a96e", marginBottom: 8 }}>
              Check your email
            </div>
            <div style={{ fontSize: 12, color: "#7a6a50", lineHeight: 1.6 }}>
              We sent a sign-in link to<br />
              <span style={{ color: "#c9a96e" }}>{email}</span>.<br />
              Click it to sign in.
            </div>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              style={{
                marginTop: 20, background: "none", border: "none",
                color: "#7a6a50", fontSize: 11, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: 1,
              }}
            >
              USE A DIFFERENT EMAIL
            </button>
          </>
        )}
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans&family=DM+Serif+Display&display=swap');
      `}</style>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>
);
