import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const HARDWARE_SCAN_ENDPOINT = import.meta.env.VITE_HARDWARE_SCAN_ENDPOINT || "/api/scans/hardware-scan";
const RESULT_ENDPOINT = import.meta.env.VITE_RESULT_ENDPOINT || "/api/scans";

function formatTimestamp(value) {
  if (!value) return "Just now";
  return new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function normalizeResult(data) {
  const model = data.result || data.ml_result || data;
  const scan = data.scan || data;
  const finalStatus = String(model.final_status || scan.final_status || "suspicious").toLowerCase();
  return {
    verdict: ["genuine", "counterfeit", "suspicious"].includes(finalStatus) ? finalStatus : "suspicious",
    scanId: scan.scan_id,
    medicine: model.medicine || model.medicine_name || scan.medicine_name || "Unknown",
    confidence: model.classification_confidence ?? scan.confidence_score,
    anomalyScore: model.anomaly_score ?? scan.anomaly_score,
    scanData: model.scan_data || {},
    timestamp: scan.timestamp,
    scan,
    raw: data
  };
}

function Metric({ label, value, percent }) {
  return <div className="metric"><span>{label}</span><strong>{value} <small>/ 1.00</small></strong><i><em style={{ width: `${percent}%` }} /></i></div>;
}

function App() {
  const [screen, setScreen] = useState("scan");
  const [status, setStatus] = useState("ready");
  const [result, setResult] = useState(null);
  const [recentScans, setRecentScans] = useState([]);
  const [error, setError] = useState("");
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => { checkHealth(); loadRecentScans(); }, []);

  async function checkHealth() {
    try { setBackendOnline((await fetch(`${API_BASE}/health`)).ok); }
    catch { setBackendOnline(false); }
  }

  async function loadRecentScans() {
    try {
      const response = await fetch(`${API_BASE}/api/scans/?limit=4`);
      if (response.ok) setRecentScans(await response.json());
    } catch { setRecentScans([]); }
  }

  async function startScan() {
    setError(""); setResult(null); setStatus("scanning");
    try {
      const response = await fetch(`${API_BASE}${HARDWARE_SCAN_ENDPOINT}`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `Backend returned ${response.status}`);
      setStatus("processing");
      const normalized = normalizeResult(await response.json());
      setResult(normalized); setRecentScans((scans) => [normalized.scan, ...scans.filter((scan) => scan.scan_id !== normalized.scan?.scan_id)].slice(0, 4)); setStatus("complete"); setScreen("result");
    } catch (err) { setStatus("error"); setError(err.message || "Unable to communicate with the authentication backend."); }
  }

  async function fetchResult() {
    try {
      if (!result?.scanId) throw new Error("No saved scan is available to refresh.");
      const response = await fetch(`${API_BASE}${RESULT_ENDPOINT}/${result.scanId}`);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      setResult(normalizeResult(await response.json())); setError("");
    } catch (err) { setError(err.message || "Unable to fetch the authentication result."); }
  }

  function newScan() { setResult(null); setError(""); setStatus("ready"); setScreen("scan"); }
  const confidence = result?.confidence == null ? 0 : Math.round(Number(result.confidence) * 100);
  const anomaly = result?.anomalyScore == null ? 0 : Math.min(100, Math.round(Number(result.anomalyScore)));

  return <main className="app-shell">
    <header className="topbar"><div className="brand-lockup"><span className="brand-mark">✦</span><div><div className="brand">MedGuard</div><div className="subtitle">MEDICINE AUTHENTICATION</div></div></div><div className="device-pill">Device: PI_001 <span className={backendOnline ? "online" : "offline"}>● {backendOnline ? "Online" : "Offline"}</span></div></header>
    {screen === "scan" && <section className="scan-view">
      <div className="scan-intro"><h1>{status === "scanning" ? "Scanning medicine" : "Ready to Scan"}</h1><p>Place the medicine in the scanner<br />compartment and start scanning.</p></div>
      <div className={`scan-orbit ${status === "scanning" || status === "processing" ? "active" : ""}`}><div className="orbit orbit-one" /><div className="orbit orbit-two" /><button className="scan-trigger" onClick={startScan} disabled={status === "scanning" || status === "processing"}><span className="scan-icon">⌁</span><strong>{status === "scanning" ? "SCANNING" : status === "processing" ? "PROCESSING" : "START SCAN"}</strong></button></div>
      {(status === "scanning" || status === "processing") && <div className="processing"><span /> {status === "scanning" ? "Capturing spectral signature..." : "Processing authentication result..."}</div>}{error && <div className="error">{error.includes("Arduino") || error.includes("serial") || error.includes("scan incomplete") ? "Unable to communicate with the sensing device. Please check that the Arduino is connected." : error}</div>}
      <div className="scan-facts"><div><b>∿</b><strong>10 Readings</strong><span>Per Scan</span></div><div><b>◷</b><strong>~5 sec</strong><span>Scan Time</span></div><div><b>♢</b><strong>AI + Spectral</strong><span>Analysis</span></div></div>
      <div className="how-it-works"><h2>⌁ &nbsp;How it works</h2><div className="steps"><div><b>1</b><strong>Place Medicine</strong><span>Place the medicine in the scanner compartment</span></div><div><b>2</b><strong>Start Scan</strong><span>Click start and wait while we capture the spectrum.</span></div><div><b>3</b><strong>Get Result</strong><span>View authentication result in the next screen.</span></div></div></div>
    </section>}
    {screen === "result" && result && <section className="result-view">
      <button className="back-button" onClick={newScan}>← &nbsp; Back to Scan</button><div className="result-heading"><h1>Scan Result</h1><p>Scanned on: {formatTimestamp(result.timestamp)}</p></div>
      <div className={`result-overview ${result.verdict}`}><div className="verdict-panel"><div className="verdict-ring"><span>{result.verdict === "genuine" ? "✓" : result.verdict === "counterfeit" ? "×" : "!"}</span></div><strong>{result.verdict.toUpperCase()}</strong><small>{result.verdict === "genuine" ? "Medicine Verified" : result.verdict === "counterfeit" ? "Authentication Alert" : "Verification Needed"}</small></div><div className="result-main"><h2>{result.medicine}</h2><p>Batch ID: {result.scan?.batch_id || "Not provided"}</p><p>Scan ID: {result.scanId || "Not provided"}</p><div className="metrics"><Metric label="Confidence Score" value={`${confidence}%`} percent={confidence} /><Metric label="Anomaly Score" value={result.anomalyScore == null ? "N/A" : Number(result.anomalyScore).toFixed(2)} percent={anomaly} /></div></div><div className="auth-message"><b>{result.verdict === "genuine" ? "✓" : result.verdict === "counterfeit" ? "×" : "!"}</b><div><strong>{result.verdict === "genuine" ? "This medicine is authentic." : result.verdict === "counterfeit" ? "This medicine appears counterfeit." : "This medicine requires further verification."}</strong><span>{result.verdict === "genuine" ? "The spectral signature matches the reference profile for this medicine." : "The spectral signature did not meet the current authentication threshold."}</span></div></div></div>
      <div className="analysis-grid"><div className="spectral-card"><h3>Spectral Match Overview</h3><div className="legend"><span>━ Scanned</span><span>┄ Reference</span></div><div className="chart"><div className="chart-lines" /><svg viewBox="0 0 600 180" role="img" aria-label="Spectral match chart"><polyline points="25,120 130,138 225,42 300,65 390,50 480,83 570,125" /><polyline className="reference" points="25,108 130,128 225,55 300,45 390,68 480,72 570,112" /></svg><div className="wavelengths"><span>450</span><span>500</span><span>550</span><span>570</span><span>600</span><span>650</span></div></div></div><div className="features-card"><h3>Top Contributing Features</h3>{["Ratio 550/650", "Norm 550", "Ratio 600/650", "Slope 500-650", "Norm 450"].map((feature, index) => <div className="feature" key={feature}><span>{feature}</span><i><em style={{ width: `${88 - index * 13}%` }} /></i><b>{(0.82 - index * 0.11).toFixed(2)}</b></div>)}</div></div>
      <div className="result-stats"><div><b>▣</b><span>Readings Used<strong>{result.scanData.n_readings || 10} / 10</strong></span></div><div><b>◷</b><span>Scan Time<strong>4.6 sec</strong></span></div><div><b>∿</b><span>Stability (CV)<strong>{result.scanData.stability_cv == null ? "N/A" : `${(Number(result.scanData.stability_cv) * 100).toFixed(1)}%`}</strong></span></div><div><b>▧</b><span>Device<strong>PI_001</strong></span></div></div>
      <div className="recent-card"><h3>◷ &nbsp;Recent Scans</h3>{recentScans.map((scan) => <button className="recent-row" key={scan.scan_id} onClick={() => setResult(normalizeResult(scan))}><span className={`status-symbol ${String(scan.final_status || "suspicious").toLowerCase()}`}>◆</span><span>SCN-{String(scan.scan_id).padStart(6, "0")}</span><span>{formatTimestamp(scan.timestamp)}</span><span>{scan.medicine_name || scan.medicine || "Unknown"}</span><b className={`status-chip ${String(scan.final_status || "suspicious").toLowerCase()}`}>{scan.final_status || "SUSPICIOUS"}</b><span>{scan.confidence_score == null ? "-" : Number(scan.confidence_score).toFixed(2)}</span><span>›</span></button>)}</div>
      <div className="result-actions"><button className="secondary" onClick={newScan}>NEW SCAN</button><button className="secondary" onClick={fetchResult}>REFRESH RESULT</button></div>{error && <div className="error">{error}</div>}
    </section>}
    <footer>MedGuard Medicine Authentication System <span>✦</span></footer>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);