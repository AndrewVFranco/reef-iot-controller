import { Zap, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ROLE_NAMES, PUMP_STATUS } from "@/store/doserStore";

function statusVariant(status) {
  switch (status) {
    case PUMP_STATUS.RUNNING:  return "running";
    case PUMP_STATUS.FAULT:    return "fault";
    case PUMP_STATUS.DISABLED: return "offline";
    default:                   return "ok";
  }
}

function statusLabel(status) {
  switch (status) {
    case PUMP_STATUS.RUNNING:  return "Running";
    case PUMP_STATUS.FAULT:    return "Fault";
    case PUMP_STATUS.DISABLED: return "Disabled";
    default:                   return "Idle";
  }
}

/**
 * PumpRow
 *
 * Props:
 *   pump       — merged pump object from doserStore.getPump()
 *   compact    — boolean, true for dashboard card (less detail)
 *   onDose     — optional () => void, shows Dose button
 *   onClear    — optional () => void, shows Clear Fault button (fault state only)
 */
export function PumpRow({ pump, compact = false, onDose, onClear }) {
  const isFault   = pump.status === PUMP_STATUS.FAULT;
  const isRunning = pump.status === PUMP_STATUS.RUNNING;

  return (
    <div
      className={[
        "flex items-center justify-between gap-3 py-2.5",
        isFault ? "opacity-100" : "",
      ].join(" ")}
    >
      {/* Left — role + index */}
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Status dot */}
        <div
          className={[
            "w-1.5 h-1.5 rounded-full flex-shrink-0",
            isRunning ? "bg-accent animate-pulse"      :
            isFault   ? "bg-status-fault animate-pulse-slow" :
                        "bg-status-ok",
          ].join(" ")}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white leading-tight truncate">
            {ROLE_NAMES[pump.role] ?? `Pump ${pump.index}`}
          </p>
          {!compact && (
            <p className="text-xs text-gray-500 mt-0.5">
              Pump {pump.index}
            </p>
          )}
        </div>
      </div>

      {/* Center — current draw */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Zap size={12} className="text-accent opacity-60" />
        <span className="data-value text-xs">
          {pump.current_mA > 0
            ? `${pump.current_mA.toFixed(0)} mA`
            : "— mA"}
        </span>
      </div>

      {/* Right — status + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge variant={statusVariant(pump.status)}>
          {isFault && <AlertTriangle size={10} />}
          {statusLabel(pump.status)}
        </Badge>

        {!compact && isFault && onClear && (
          <button
            onClick={onClear}
            className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 transition-colors"
          >
            Clear
          </button>
        )}

        {!compact && !isFault && onDose && (
          <button
            onClick={onDose}
            className="text-xs text-accent hover:text-accent-light underline underline-offset-2 transition-colors"
          >
            Dose
          </button>
        )}
      </div>
    </div>
  );
}
