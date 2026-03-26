import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { getPatientTokenStatus, confirmAttendance, rejectBooking } from "../services/allApi";

const STATUS_META = {
  pending:    { color:"#f59e0b", bg:"#fffbeb", border:"#fde68a", icon:"⏳", label:"Waiting for OPD to start" },
  waiting:    { color:"#6366f1", bg:"#eef2ff", border:"#c7d2fe", icon:"🪑", label:"You are in the queue" },
  consulting: { color:"#10b981", bg:"#ecfdf5", border:"#6ee7b7", icon:"👨‍⚕️", label:"You are being consulted now" },
  done:       { color:"#6b7280", bg:"#f9fafb", border:"#e5e7eb", icon:"✅", label:"Consultation complete" },
  skipped:    { color:"#ef4444", bg:"#fef2f2", border:"#fca5a5", icon:"⏭",  label:"Your token was skipped" },
};

export default function PatientDashboard() {
  const navigate = useNavigate();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [opdMsg,  setOpdMsg]  = useState("");
  const [acting,  setActing]  = useState(false);
  const [pulse,   setPulse]   = useState(false);

  const token = sessionStorage.getItem("token");

  // ── Fetch ───────────────────────────────────────────
  const fetchStatus = useCallback(async (silent = false) => {
    try {
      const res = await getPatientTokenStatus();

      // Backend returns HTTP 200 with { error: "..." } for non-error states
      // like "OPD not started" or "No booking today" — handle them gracefully.
      if (res.data?.error) {
        setOpdMsg(res.data.error);
        setData(null);
      } else if (res.data && res.data.token_number) {
        // Valid booking data — make sure it has all expected fields
        setData(res.data);
        setOpdMsg("");
        if (silent) { setPulse(true); setTimeout(() => setPulse(false), 600); }
      } else {
        // Unexpected empty response
        setOpdMsg("Status unavailable. Please try again.");
        setData(null);
      }
    } catch (err) {
      if (err.response?.status === 401) { navigate("/login"); return; }
      if (err.response?.status === 404) { setData(null); setOpdMsg("No booking found for today."); }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!token) { navigate("/login"); return; }
    fetchStatus();
    const id = setInterval(() => fetchStatus(true), 15000);
    return () => clearInterval(id);
  }, [token, fetchStatus, navigate]);

  useEffect(() => {
    if (data?.status === "done") {
      toast.success("✅ Consultation completed!");
      setTimeout(() => navigate("/mybookings"), 3000);
    }
  }, [data, navigate]);

  // ── Actions ─────────────────────────────────────────
  const handleConfirm = async () => {
    if (!data?.id) {
      toast.error("Booking ID not found. Please refresh.");
      return;
    }
    // Guard: only allow confirmation when OPD is active
    if (!data.opd_started) {
      toast.info("You can only confirm attendance after the doctor starts OPD.");
      return;
    }
    setActing(true);
    try {
      const res = await confirmAttendance(data.id);
      toast.success(
        `✅ Confirmed! Position #${res.data.queue_position} · ~${res.data.estimated_wait} min wait`
      );
      fetchStatus();
    } catch (err) {
      const msg = err.response?.data?.error || "Confirmation failed";
      toast.error(msg);
    } finally { setActing(false); }
  };

  const handleReject = async () => {
    if (!window.confirm("Are you sure you want to withdraw from this booking?")) return;
    setActing(true);
    try {
      await rejectBooking(data.id);
      toast.info("Booking withdrawn");
      navigate("/mybookings");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to withdraw");
    } finally { setActing(false); }
  };

  // ── Loading ──────────────────────────────────────────
  if (loading) return (
    <div style={S.center}>
      <div style={S.spinner} />
      <p style={{ color:"#94a3b8", marginTop:20, fontSize:14 }}>Checking your token status...</p>
      <style>{KF}</style>
    </div>
  );

  // ── No booking / OPD not started ─────────────────────
  if (!data) {
    const isNotStarted = opdMsg?.toLowerCase().includes("not started");
    const isNoBooking  = opdMsg?.toLowerCase().includes("no booking");

    return (
      <div style={S.center}>
        <div style={{ fontSize:72, marginBottom:20 }}>
          {isNotStarted ? "⏰" : isNoBooking ? "📋" : "🏥"}
        </div>
        <h2 style={{ color:"#1e293b", margin:"0 0 10px", fontSize:22, fontWeight:800 }}>
          {isNotStarted ? "OPD Hasn't Started Yet"
           : isNoBooking ? "No Booking Today"
           : opdMsg || "Status Unavailable"}
        </h2>
        <p style={{ color:"#64748b", fontSize:14, margin:"0 0 28px", maxWidth:340,
          textAlign:"center", lineHeight:1.6 }}>
          {isNotStarted
            ? "The doctor will start OPD soon. This page will auto-update when it begins."
            : isNoBooking
            ? "You don't have an active booking for today."
            : "Please refresh or contact OPD staff."}
        </p>
        {isNotStarted ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, color:"#94a3b8", fontSize:13 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:"#10b981",
                animation:"blink 1.5s ease-in-out infinite" }} />
              Auto-refreshing every 15 seconds
            </div>
            <button onClick={() => fetchStatus()} style={S.outlineBtn}>🔄 Refresh Now</button>
          </div>
        ) : (
          <button onClick={() => navigate("/booking")} style={S.primaryBtn}>Book a Token →</button>
        )}
        <style>{KF}</style>
      </div>
    );
  }

  // ── Derived — null-safe ───────────────────────────────
  const meta        = STATUS_META[data.status] || STATUS_META.waiting;
  const isConfirmed = !!data.is_confirmed;

  // opd_started is now returned directly by the backend on every response.
  // canConfirmNow = OPD is active AND patient hasn't confirmed yet.
  // isPending     = OPD not started yet → show info only, no confirm button.
  const opdStarted    = !!data.opd_started;
  const canConfirmNow = opdStarted && !isConfirmed && ["pending", "waiting"].includes(data.status);
  const isPending     = !opdStarted && !isConfirmed;
  const canWithdraw   = ["pending", "waiting"].includes(data.status);

  const ahead   = data.tokens_ahead;
  const wait    = data.estimated_wait_minutes;
  const avgMin  = data.avg_consult_minutes;

  const showQueue = isConfirmed && ahead !== null && ahead !== undefined;
  const showWait  = isConfirmed && wait  !== null && wait  !== undefined;
  const isMyTurn  = showQueue && ahead === 0 && data.status === "waiting";

  const progress = data.status === "consulting" || data.status === "done"
    ? 100
    : data.current_token && data.token_number
    ? Math.min(100, Math.round((data.current_token / data.token_number) * 100))
    : 0;

  return (
    <div style={S.page}>
      <style>{KF}</style>

      <div style={{ width:"100%", maxWidth:520 }}>

        {/* ── Header ── */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <h2 style={S.pageTitle}>My Token Status</h2>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
            gap:6, color:"#94a3b8", fontSize:12 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#10b981",
              animation:"blink 1.5s ease-in-out infinite" }} />
            Live · updates every 15s
            {pulse && <span style={{ color:"#10b981", fontWeight:600, marginLeft:4 }}>↻</span>}
          </div>
        </div>

        {/* ── Banners ── */}
        {isMyTurn && (
          <div style={{ ...S.banner, background:"linear-gradient(90deg,#059669,#0891b2)",
            animation:"glow 2s ease-in-out infinite" }}>
            <span style={{ fontSize:24 }}>🔔</span>
            <div>
              <div style={{ fontWeight:800, fontSize:16 }}>It's Your Turn!</div>
              <div style={{ fontSize:13, opacity:0.9 }}>Please proceed to the doctor's room</div>
            </div>
          </div>
        )}

        {data.status === "consulting" && (
          <div style={{ ...S.banner, background:"linear-gradient(90deg,#10b981,#0d9488)" }}>
            <span style={{ fontSize:24 }}>👨‍⚕️</span>
            <div>
              <div style={{ fontWeight:800, fontSize:16 }}>You're Being Consulted</div>
              <div style={{ fontSize:13, opacity:0.9 }}>You are currently with the doctor</div>
            </div>
          </div>
        )}

        {data.status === "skipped" && (
          <div style={{ ...S.banner, background:"linear-gradient(90deg,#ef4444,#dc2626)" }}>
            <span style={{ fontSize:24 }}>⏭</span>
            <div>
              <div style={{ fontWeight:800, fontSize:16 }}>Your Token Was Skipped</div>
              <div style={{ fontSize:13, opacity:0.9 }}>Please contact OPD staff for help</div>
            </div>
          </div>
        )}

        {/* ── Main token card ── */}
        <div style={{
          ...S.card,
          borderTop: `4px solid ${meta.color}`,
          animation: pulse ? "flash 0.6s ease" : "none",
        }}>

          {/* Token + status */}
          <div style={{ display:"flex", justifyContent:"space-between",
            alignItems:"flex-start", marginBottom:20 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:"#94a3b8",
                letterSpacing:1.5, marginBottom:6 }}>
                MY TOKEN NUMBER
              </div>
              <span style={{ fontSize:72, fontWeight:900, color:"#0f4c75", lineHeight:1 }}>
                #{data.token_number}
              </span>
              <div style={{ fontSize:13, color:"#64748b", marginTop:6 }}>
                {data.session?.charAt(0).toUpperCase()+data.session?.slice(1)} Session · {data.booking_date}
              </div>
            </div>

            <div style={{ textAlign:"right", display:"flex", flexDirection:"column",
              gap:8, alignItems:"flex-end" }}>
              <div style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:meta.bg, color:meta.color,
                border:`1.5px solid ${meta.border}`,
                fontSize:12, fontWeight:700, padding:"7px 14px", borderRadius:20,
              }}>
                <span>{meta.icon}</span>
                <span>{data.status?.toUpperCase()}</span>
              </div>
              <div style={{
                display:"inline-flex", alignItems:"center", gap:5,
                fontSize:12, fontWeight:600,
                color:      isConfirmed ? "#10b981" : "#f59e0b",
                background: isConfirmed ? "#ecfdf5"  : "#fffbeb",
                border:     `1px solid ${isConfirmed ? "#6ee7b7" : "#fde68a"}`,
                padding:"4px 10px", borderRadius:12,
              }}>
                {isConfirmed ? "✅ Confirmed" : "⚠️ Not Confirmed"}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height:1, background:"#f1f5f9", margin:"0 0 20px" }} />

          {/* ── Stats row ── */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:20 }}>

            {/* Now Calling */}
            <div style={S.statBox()}>
              <div style={{ fontSize:20, marginBottom:6 }}>🔔</div>
              <div style={{ fontWeight:800, fontSize:17, color:"#0f4c75" }}>
                {data.current_token ? `#${data.current_token}` : "—"}
              </div>
              <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>Now Calling</div>
            </div>

            {/* Ahead of You */}
            <div style={S.statBox(isMyTurn)}>
              <div style={{ fontSize:20, marginBottom:6 }}>👥</div>
              <div style={{ fontWeight:800, fontSize:17, color: isMyTurn ? "#10b981" : "#0f4c75" }}>
                {!isConfirmed
                  ? <span style={{ fontSize:12, color:"#f59e0b", fontWeight:600 }}>Confirm first</span>
                  : !showQueue ? "—"
                  : isMyTurn  ? "You're Next!"
                  : ahead}
              </div>
              <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>Ahead of You</div>
            </div>

            {/* Est. Wait */}
            <div style={S.statBox(isMyTurn || data.status === "consulting")}>
              <div style={{ fontSize:20, marginBottom:6 }}>⏱</div>
              <div style={{ fontWeight:800, fontSize:17,
                color: (isMyTurn || data.status === "consulting") ? "#10b981" : "#0f4c75" }}>
                {data.status === "consulting" ? "Now!"
                  : data.status === "done"    ? "Done"
                  : !isConfirmed || !showWait ? <span style={{ fontSize:12, color:"#94a3b8" }}>—</span>
                  : isMyTurn                  ? "Soon!"
                  : `~${wait} min`}
              </div>
              <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>Est. Wait</div>
            </div>
          </div>

          {/* ── Progress bar ── */}
          <div style={{ marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between",
              fontSize:11, color:"#94a3b8", fontWeight:600, marginBottom:8 }}>
              <span>Queue Progress</span>
              {avgMin != null
                ? <span>~{avgMin} min/patient</span>
                : <span style={{ color:"#e2e8f0" }}>OPD not started</span>}
            </div>
            <div style={{ height:10, background:"#f1f5f9", borderRadius:10, overflow:"hidden" }}>
              <div style={{
                height:"100%", borderRadius:10,
                background: data.status === "consulting" || data.status === "done"
                  ? "linear-gradient(90deg,#10b981,#0d9488)"
                  : "linear-gradient(90deg,#0f4c75,#6366f1)",
                width:`${progress}%`,
                transition:"width 1s ease",
              }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between",
              fontSize:11, color:"#94a3b8", marginTop:6 }}>
              <span>Token #1</span>
              <span>Your Token #{data.token_number}</span>
            </div>
          </div>

          {/* Status message */}
          <div style={{
            display:"flex", alignItems:"center", gap:12,
            padding:"14px 16px", borderRadius:12,
            background:meta.bg, border:`1.5px solid ${meta.border}`,
          }}>
            <span style={{ fontSize:22 }}>{meta.icon}</span>
            <span style={{ fontSize:13, color:meta.color, fontWeight:600, lineHeight:1.4 }}>
              {meta.label}
            </span>
          </div>
        </div>

        {/* ── Action card ── */}
        <div style={{ ...S.card, marginTop:14 }}>

          {/* OPD started, not confirmed → urgent confirm */}
          {canConfirmNow && (
            <>
              <div style={{ ...S.alertBox, background:"#fffbeb",
                border:"1.5px solid #fde68a", marginBottom:16 }}>
                <span style={{ fontSize:22 }}>⚡</span>
                <div>
                  <div style={{ fontWeight:700, color:"#92400e", fontSize:14 }}>
                    OPD Has Started!
                  </div>
                  <div style={{ color:"#a16207", fontSize:12, marginTop:2 }}>
                    Confirm your attendance now to join the active queue before you miss your slot.
                  </div>
                </div>
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={handleConfirm} disabled={acting}
                  style={{ ...S.primaryBtn, flex:1, opacity: acting ? 0.7 : 1 }}>
                  {acting ? (
                    <span style={{ display:"flex", alignItems:"center",
                      gap:8, justifyContent:"center" }}>
                      <span style={S.btnSpinner} /> Confirming...
                    </span>
                  ) : "✅ Confirm Attendance"}
                </button>
                <button onClick={handleReject} disabled={acting} style={S.dangerBtn}>
                  ❌ Withdraw
                </button>
                <button onClick={() => fetchStatus()} disabled={acting}
                  title="Refresh now" style={S.iconBtn}>🔄</button>
              </div>
            </>
          )}

          {/* Pending — OPD not yet started → info only, NO confirm button */}
          {isPending && (
            <>
              <div style={{ ...S.alertBox, background:"#f0f9ff",
                border:"1.5px solid #bae6fd", marginBottom:16 }}>
                <span style={{ fontSize:22 }}>ℹ️</span>
                <div>
                  <div style={{ fontWeight:700, color:"#0369a1", fontSize:14 }}>
                    Booking Confirmed — Waiting for OPD to Start
                  </div>
                  <div style={{ color:"#0284c7", fontSize:12, marginTop:2 }}>
                    Once the doctor starts OPD, you'll be prompted here to confirm your attendance.
                  </div>
                </div>
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={handleReject} disabled={acting}
                  style={{ ...S.dangerBtn, flex:1 }}>
                  ❌ Withdraw Booking
                </button>
                <button onClick={() => fetchStatus()} disabled={acting}
                  title="Refresh now" style={S.iconBtn}>🔄</button>
              </div>
            </>
          )}

          {/* Already confirmed and in queue → just withdraw + refresh */}
          {isConfirmed && ["waiting", "pending"].includes(data.status) && (
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={handleReject} disabled={acting}
                style={{ ...S.dangerBtn, flex:1 }}>
                ❌ Withdraw
              </button>
              <button onClick={() => fetchStatus()} disabled={acting}
                title="Refresh now" style={S.iconBtn}>🔄</button>
            </div>
          )}

          {/* No action needed for consulting / done / skipped → just refresh */}
          {["consulting", "done", "skipped"].includes(data.status) && (
            <div style={{ display:"flex", justifyContent:"center" }}>
              <button onClick={() => fetchStatus()} disabled={acting}
                title="Refresh now" style={S.iconBtn}>🔄 Refresh</button>
            </div>
          )}
        </div>

        {/* ── Doctor info card ── */}
        {data.doctor_name && (
          <div style={{ ...S.card, marginTop:14, display:"flex",
            alignItems:"center", gap:14 }}>
            <div style={{
              width:44, height:44, borderRadius:"50%",
              background:"linear-gradient(135deg,#0f4c75,#118a7e)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:20, color:"#fff", flexShrink:0,
            }}>👨‍⚕️</div>
            <div>
              <div style={{ fontWeight:700, color:"#0f4c75", fontSize:15 }}>
                {data.doctor_name}
              </div>
              <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>
                {data.hospital} · {data.department}
              </div>
            </div>
          </div>
        )}

        <p style={{ textAlign:"center", fontSize:12, color:"#cbd5e1", marginTop:16 }}>
          🔄 Auto-refreshes every 15 seconds
        </p>
      </div>
    </div>
  );
}

const KF = `
  @keyframes spin  { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
  @keyframes glow  { 0%,100% { box-shadow: 0 4px 20px rgba(16,185,129,0.3); }
                     50%      { box-shadow: 0 4px 32px rgba(16,185,129,0.6); } }
  @keyframes flash { 0%,100% { background: #fff; } 50% { background: #f0fdf4; } }
`;

const S = {
  page:      { minHeight:"100vh", background:"linear-gradient(160deg,#f0f4f8 0%,#e8f0fe 100%)",
               display:"flex", flexDirection:"column", alignItems:"center", padding:"36px 20px" },
  center:    { minHeight:"100vh", background:"#f8fafc", display:"flex", flexDirection:"column",
               alignItems:"center", justifyContent:"center", padding:"40px 20px", textAlign:"center" },
  pageTitle: { fontFamily:"'Playfair Display',serif", fontSize:26, fontWeight:800,
               color:"#0f4c75", margin:0 },
  card:      { background:"#fff", borderRadius:18, padding:"24px",
               boxShadow:"0 4px 24px rgba(0,0,0,0.07)" },
  banner:    { display:"flex", alignItems:"center", gap:14, color:"#fff",
               padding:"16px 20px", borderRadius:14, marginBottom:14,
               boxShadow:"0 4px 20px rgba(0,0,0,0.15)" },
  alertBox:  { display:"flex", alignItems:"flex-start", gap:12,
               padding:"14px 16px", borderRadius:12 },
  statBox:   (highlight = false) => ({
               background:  highlight ? "#ecfdf5" : "#f8fafc",
               border:      `1px solid ${highlight ? "#6ee7b7" : "#f1f5f9"}`,
               borderRadius:12, padding:"14px 10px", textAlign:"center",
               transition:"all 0.3s",
             }),
  primaryBtn:{ background:"linear-gradient(90deg,#0f4c75,#118a7e)", color:"#fff",
               border:"none", borderRadius:12, padding:"13px 20px",
               fontWeight:700, fontSize:14, cursor:"pointer" },
  dangerBtn: { background:"#fef2f2", color:"#dc2626", border:"1.5px solid #fca5a5",
               borderRadius:12, padding:"13px 16px", fontWeight:600,
               fontSize:14, cursor:"pointer" },
  outlineBtn:{ background:"#fff", color:"#0f4c75", border:"2px solid #0f4c75",
               borderRadius:12, padding:"11px 24px", fontWeight:700,
               fontSize:14, cursor:"pointer" },
  iconBtn:   { background:"#f1f5f9", color:"#475569", border:"none", borderRadius:12,
               padding:"13px 16px", fontWeight:600, fontSize:16, cursor:"pointer" },
  spinner:   { width:44, height:44, borderRadius:"50%", border:"3px solid #e2e8f0",
               borderTopColor:"#0f4c75", animation:"spin 0.8s linear infinite" },
  btnSpinner:{ width:14, height:14, borderRadius:"50%",
               border:"2px solid rgba(255,255,255,0.4)",
               borderTopColor:"#fff", animation:"spin 0.8s linear infinite",
               display:"inline-block" },
};
