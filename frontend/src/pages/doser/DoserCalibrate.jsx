import { useState, useEffect, useRef } from "react";
import { useDoserStore, ROLE_NAMES } from "@/store/doserStore";
import { doserApi } from "@/api/http";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Play, Square, CheckCircle, AlertCircle, Timer } from "lucide-react";

// ── Steps ─────────────────────────────────────────────────────────────────

const STEPS = {
  SELECT:   "select",    // choose pump
  PRIME:    "prime",     // run pump to prime line
  MEASURE:  "measure",   // run timed dose, measure output
  ENTER:    "enter",     // enter measured volume
  CONFIRM:  "confirm",   // review and submit
  DONE:     "done",      // success
};

// ── Timer hook ────────────────────────────────────────────────────────────

function useStopwatch() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startRef = useRef(null);
  const rafRef   = useRef(null);

  function start() {
    startRef.current = Date.now() - elapsed * 1000;
    setRunning(true);
  }

  function stop() {
    setRunning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  function reset() {
    stop();
    setElapsed(0);
  }

  useEffect(() => {
    if (!running) return;
    function tick() {
      setElapsed((Date.now() - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  return { elapsed, running, start, stop, reset };
}

// ── Step components ───────────────────────────────────────────────────────

function StepIndicator({ current }) {
  const steps = [
    { key: STEPS.SELECT,  label: "Select" },
    { key: STEPS.PRIME,   label: "Prime"  },
    { key: STEPS.MEASURE, label: "Measure" },
    { key: STEPS.ENTER,   label: "Volume" },
    { key: STEPS.CONFIRM, label: "Confirm" },
  ];

  const currentIdx = steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div
              className={[
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                i < currentIdx  ? "bg-accent text-surface-900"       :
                i === currentIdx ? "bg-accent text-surface-900 ring-2 ring-accent/30" :
                                   "bg-surface-700 text-gray-500",
              ].join(" ")}
            >
              {i < currentIdx ? "✓" : i + 1}
            </div>
            <span className={[
              "text-xs whitespace-nowrap",
              i === currentIdx ? "text-accent-light" : "text-gray-600",
            ].join(" ")}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={[
              "flex-1 h-px mx-1 mb-4",
              i < currentIdx ? "bg-accent" : "bg-surface-600",
            ].join(" ")} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function DoserCalibrate() {
  const schedule           = useDoserStore((s) => s.schedule);
  const fetchSchedule      = useDoserStore((s) => s.fetchSchedule);
  const scheduleAckStatus  = useDoserStore((s) => s.scheduleAckStatus);
  const setAckPending      = useDoserStore((s) => s.setScheduleAckPending);

  const [step,          setStep]         = useState(STEPS.SELECT);
  const [selectedPump,  setSelectedPump] = useState(null);
  const [primeVolume,   setPrimeVolume]  = useState("10");
  const [measuredVol,   setMeasuredVol]  = useState("");
  const [expectedMa,    setExpectedMa]   = useState("");
  const [tolerance,     setTolerance]    = useState("25");
  const [loading,       setLoading]      = useState(false);
  const [error,         setError]        = useState(null);

  const stopwatch = useStopwatch();

  useEffect(() => {
    if (!schedule) fetchSchedule();
  }, []);

  const pumps = schedule
    ? Object.entries(schedule.pumps ?? {})
        .filter(([, cfg]) => cfg.role !== "DISABLED")
        .map(([idx, cfg]) => ({ index: Number(idx), ...cfg }))
    : [];

  const pump = pumps.find((p) => p.index === selectedPump);

  // ── Step: SELECT ──────────────────────────────────────────────────────

  if (step === STEPS.SELECT) {
    return (
      <div className="animate-fade-in max-w-lg">
        <h2 className="text-base font-semibold text-white mb-1">Select Pump</h2>
        <p className="text-sm text-gray-400 mb-5">
          Choose the pump you want to calibrate. Have a graduated cylinder ready.
        </p>
        {!schedule ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="space-y-2">
            {pumps.map((p) => (
              <button
                key={p.index}
                onClick={() => { setSelectedPump(p.index); setStep(STEPS.PRIME); }}
                className={[
                  "w-full flex items-center justify-between px-4 py-3.5",
                  "card hover:border-accent/40 transition-all text-left",
                ].join(" ")}
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {ROLE_NAMES[p.role] ?? `Pump ${p.index}`}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Pump {p.index}
                  </p>
                </div>
                <Badge variant={p.enabled ? "ok" : "offline"}>
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Step: PRIME ───────────────────────────────────────────────────────

  if (step === STEPS.PRIME) {
    async function handlePrime() {
      const vol = parseFloat(primeVolume);
      if (isNaN(vol) || vol <= 0) { setError("Enter a valid volume"); return; }
      setLoading(true); setError(null);
      try {
        await doserApi.manualDose(selectedPump, vol);
        setStep(STEPS.MEASURE);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    }

    return (
      <div className="animate-fade-in max-w-lg">
        <StepIndicator current={STEPS.PRIME} />
        <h2 className="text-base font-semibold text-white mb-1">Prime the Line</h2>
        <p className="text-sm text-gray-400 mb-5">
          Run the pump to fill the tubing and remove air bubbles. The output
          during this step is not measured.
        </p>
        <div className="card p-4 mb-4">
          <label className="section-label block mb-2">Prime volume (ml)</label>
          <input
            type="number"
            value={primeVolume}
            onChange={(e) => setPrimeVolume(e.target.value)}
            min="1"
            className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
        </div>
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(STEPS.SELECT)}>
            Back
          </Button>
          <Button variant="primary" onClick={handlePrime} loading={loading} className="flex-1">
            <Play size={14} /> Run Prime
          </Button>
        </div>
      </div>
    );
  }

  // ── Step: MEASURE ─────────────────────────────────────────────────────

  if (step === STEPS.MEASURE) {
    async function startMeasure() {
      stopwatch.reset();
      setError(null);
      try {
        await doserApi.manualDose(selectedPump, 999);  // large volume to run freely
        stopwatch.start();
      } catch (e) { setError(e.message); }
    }

    async function stopMeasure() {
      stopwatch.stop();
      // Send a tiny dose to stop the pump (0.001ml forces immediate stop)
      try { await doserApi.manualDose(selectedPump, 0); } catch (_) {}
      setStep(STEPS.ENTER);
    }

    return (
      <div className="animate-fade-in max-w-lg">
        <StepIndicator current={STEPS.MEASURE} />
        <h2 className="text-base font-semibold text-white mb-1">Measure Output</h2>
        <p className="text-sm text-gray-400 mb-5">
          Place a graduated cylinder under the output tube.
          Start the pump, let it run for at least 30 seconds, then stop.
          Measure the exact volume collected.
        </p>

        {/* Stopwatch */}
        <div className="card p-6 mb-4 text-center">
          <div className="text-5xl font-mono font-bold text-accent-light mb-2 tabular-nums">
            {stopwatch.elapsed.toFixed(1)}
            <span className="text-2xl text-gray-500 ml-1">s</span>
          </div>
          <p className="text-xs text-gray-500">
            {stopwatch.running ? "Pump running — collecting output…" : "Press Start to begin"}
          </p>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(STEPS.PRIME)}>
            Back
          </Button>
          {!stopwatch.running ? (
            <Button variant="primary" onClick={startMeasure} className="flex-1">
              <Play size={14} /> Start Pump
            </Button>
          ) : (
            <Button variant="danger" onClick={stopMeasure} className="flex-1">
              <Square size={14} /> Stop &amp; Measure
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Step: ENTER ───────────────────────────────────────────────────────

  if (step === STEPS.ENTER) {
    return (
      <div className="animate-fade-in max-w-lg">
        <StepIndicator current={STEPS.ENTER} />
        <h2 className="text-base font-semibold text-white mb-1">Enter Measurements</h2>
        <p className="text-sm text-gray-400 mb-5">
          Read the graduated cylinder and enter the exact volume collected.
          The pump ran for <span className="text-white font-mono">{stopwatch.elapsed.toFixed(1)}s</span>.
        </p>

        <div className="card p-4 space-y-4 mb-4">
          <div>
            <label className="section-label block mb-2">Volume collected (ml)</label>
            <input
              type="number"
              value={measuredVol}
              onChange={(e) => setMeasuredVol(e.target.value)}
              min="0.1"
              step="0.1"
              placeholder="e.g. 23.5"
              className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="section-label block mb-2">Expected current (mA)</label>
            <input
              type="number"
              value={expectedMa}
              onChange={(e) => setExpectedMa(e.target.value)}
              min="1"
              placeholder="e.g. 220"
              className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <p className="text-xs text-gray-600 mt-1">
              Current draw observed while pump was running
            </p>
          </div>
          <div>
            <label className="section-label block mb-2">Fault tolerance (%)</label>
            <input
              type="number"
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              min="5"
              max="50"
              className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(STEPS.MEASURE)}>
            Back
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              if (!measuredVol || !expectedMa) { setError("Fill in all fields"); return; }
              setError(null);
              setStep(STEPS.CONFIRM);
            }}
          >
            Review
          </Button>
        </div>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    );
  }

  // ── Step: CONFIRM ─────────────────────────────────────────────────────

  if (step === STEPS.CONFIRM) {
    const secRan    = stopwatch.elapsed;
    const volMl     = parseFloat(measuredVol);
    const flowRate  = secRan > 0 ? volMl / secRan : 0;

    async function handleSubmit() {
      setLoading(true); setError(null);
      setAckPending();
      try {
        await doserApi.calibrate(selectedPump, {
          ml_delivered:        volMl,
          seconds_ran:         secRan,
          expected_current_mA: parseFloat(expectedMa),
          tolerance_percent:   parseFloat(tolerance),
        });
        setStep(STEPS.DONE);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    }

    return (
      <div className="animate-fade-in max-w-lg">
        <StepIndicator current={STEPS.CONFIRM} />
        <h2 className="text-base font-semibold text-white mb-1">Confirm Calibration</h2>
        <p className="text-sm text-gray-400 mb-5">
          Review the values below. Saving will update the pump's flow rate and
          current thresholds immediately.
        </p>

        <div className="card p-4 space-y-2 mb-4">
          {[
            ["Pump",           ROLE_NAMES[pump?.role] ?? `Pump ${selectedPump}`],
            ["Duration",       `${secRan.toFixed(2)} s`],
            ["Volume",         `${volMl.toFixed(2)} ml`],
            ["Flow rate",      `${flowRate.toFixed(4)} ml/s`],
            ["Expected mA",    `${parseFloat(expectedMa).toFixed(0)} mA`],
            ["Tolerance",      `${tolerance}%`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <span className="text-gray-500">{label}</span>
              <span className="data-value text-xs text-white">{value}</span>
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(STEPS.ENTER)}>
            Back
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={loading} className="flex-1">
            <CheckCircle size={14} /> Save Calibration
          </Button>
        </div>
      </div>
    );
  }

  // ── Step: DONE ────────────────────────────────────────────────────────

  if (step === STEPS.DONE) {
    return (
      <div className="animate-fade-in max-w-lg text-center py-8">
        <div className="w-16 h-16 rounded-full bg-emerald-900/30 border border-emerald-800/50 flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-status-ok" />
        </div>
        <h2 className="text-base font-semibold text-white mb-2">Calibration Saved</h2>
        <p className="text-sm text-gray-400 mb-4">
          {ROLE_NAMES[pump?.role] ?? `Pump ${selectedPump}`} has been calibrated.
          The Pico will apply the new values immediately.
        </p>
        {scheduleAckStatus === "ok" && (
          <div className="flex items-center gap-2 justify-center py-2 mb-4 text-xs text-status-ok animate-fade-in">
            <CheckCircle size={13} /> Confirmed by Pico
          </div>
        )}
        {scheduleAckStatus === "timeout" && (
          <div className="flex items-center gap-2 justify-center py-2 mb-4 text-xs text-status-fault animate-fade-in">
            <AlertCircle size={13} /> No confirmation received — Pico may be offline
          </div>
        )}
        {scheduleAckStatus === "pending" && (
          <div className="flex items-center gap-2 justify-center py-2 mb-4 text-xs text-gray-400 animate-fade-in">
            <Spinner size="sm" /> Waiting for Pico confirmation…
          </div>
        )}
        <Button
          variant="primary"
          onClick={() => {
            setStep(STEPS.SELECT);
            setSelectedPump(null);
            setMeasuredVol("");
            setExpectedMa("");
            stopwatch.reset();
          }}
        >
          Calibrate Another Pump
        </Button>
      </div>
    );
  }

  return null;
}