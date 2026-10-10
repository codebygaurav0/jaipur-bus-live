const SUPPORTED_BUS_STATUSES = new Set([
  "LIVE · MOVING",
  "LIVE · SLOW",
  "LIVE · IDLE",
  "LIVE · STOPPED",
  "GPS STALE",
  "GPS UPDATE UNAVAILABLE",
  "GPS INVALID",
  "GPS UNCERTAIN",
]);

export function createMarkerAnimator({
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  durationMs = 900,
} = {}) {
  if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    throw new Error("Animation frame APIs are not available");
  }

  const animations = new Map();

  const cancel = (key) => {
    const animation = animations.get(key);
    if (!animation) return;
    if (animation.frame !== null) cancelFrame(animation.frame);
    animations.delete(key);
  };

  return {
    move(key, marker, target) {
      const [targetLatitude, targetLongitude] = target.map(Number);
      if (
        !Number.isFinite(targetLatitude) ||
        !Number.isFinite(targetLongitude)
      ) {
        throw new TypeError("Marker target coordinates must be finite");
      }

      cancel(key);
      const startPosition = marker.getLatLng();
      const startLatitude = Number(startPosition.lat);
      const startLongitude = Number(startPosition.lng);
      if (!Number.isFinite(startLatitude) || !Number.isFinite(startLongitude)) {
        marker.setLatLng([targetLatitude, targetLongitude]);
        return;
      }

      if (
        startLatitude === targetLatitude &&
        startLongitude === targetLongitude
      ) {
        marker.setLatLng([targetLatitude, targetLongitude]);
        return;
      }

      let startTime = null;
      const animation = { frame: null };
      animations.set(key, animation);

      const step = (timestamp) => {
        if (animations.get(key) !== animation) return;
        if (startTime === null) startTime = timestamp;
        const progress = Math.min(
          1,
          Math.max(0, (timestamp - startTime) / durationMs)
        );
        const latitude =
          startLatitude + (targetLatitude - startLatitude) * progress;
        const longitude =
          startLongitude + (targetLongitude - startLongitude) * progress;
        marker.setLatLng([latitude, longitude]);

        if (progress < 1) {
          animation.frame = requestFrame(step);
        } else {
          marker.setLatLng([targetLatitude, targetLongitude]);
          animations.delete(key);
        }
      };

      animation.frame = requestFrame(step);
    },
    cancel,
    cancelAll() {
      for (const key of animations.keys()) cancel(key);
    },
    isAnimating(key) {
      return animations.has(key);
    },
  };
}

export function calculateBearingDegrees(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitude1 = radians(fromLatitude);
  const latitude2 = radians(toLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function smoothBearingDegrees(previousBearing, nextBearing, factor = 0.5) {
  const normalizedNext = ((nextBearing % 360) + 360) % 360;
  if (!Number.isFinite(previousBearing)) return normalizedNext;

  const normalizedPrevious = ((previousBearing % 360) + 360) % 360;
  const boundedFactor = Math.min(1, Math.max(0, factor));
  const difference = ((normalizedNext - normalizedPrevious + 540) % 360) - 180;
  return (normalizedPrevious + difference * boundedFactor + 360) % 360;
}

export function getBusStatus(bus) {
  const status = bus?.status || bus?.telemetryStatus;
  return SUPPORTED_BUS_STATUSES.has(status) ? status : "GPS UPDATE UNAVAILABLE";
}

export function getBusSpeedLabel(bus) {
  const status = getBusStatus(bus);
  if (
    bus?.speed !== null &&
    bus?.speed !== undefined &&
    bus.speed !== "" &&
    Number.isFinite(Number(bus.speed))
  ) {
    return `${Number(bus.speed)} km/h`;
  }
  if (status === "LIVE · MOVING") return "Moving";
  if (status === "LIVE · SLOW") return "Slow";
  if (status === "LIVE · IDLE") return "Idle";
  if (status === "LIVE · STOPPED") return "Stopped";
  return "Speed unavailable";
}

export function getBusStatusStyle(status) {
  if (status === "LIVE · MOVING") {
    return {
      background: "#dcfce7",
      foreground: "#166534",
      border: "#16a34a",
      accent: "#10b981",
      glow: "rgba(16, 185, 129, 0.45)",
    };
  }
  if (status === "LIVE · STOPPED") {
    return {
      background: "#fee2e2",
      foreground: "#991b1b",
      border: "#dc2626",
      accent: "#ef4444",
      glow: "rgba(239, 68, 68, 0.45)",
    };
  }
  if (status === "LIVE · SLOW" || status === "LIVE · IDLE") {
    return {
      background: "#ffedd5",
      foreground: "#9a3412",
      border: "#ea580c",
      accent: "#f97316",
      glow: "rgba(249, 115, 22, 0.45)",
    };
  }
  return {
    background: "#f1f5f9",
    foreground: "#475569",
    border: "#64748b",
    accent: "#64748b",
    glow: "rgba(100, 116, 139, 0.25)",
  };
}

export function getBusStatusClasses(status) {
  if (status === "LIVE · MOVING") return "bg-emerald-100 text-emerald-800";
  if (status === "LIVE · STOPPED") return "bg-red-100 text-red-800";
  if (status === "LIVE · SLOW" || status === "LIVE · IDLE") {
    return "bg-orange-100 text-orange-800";
  }
  return "bg-slate-100 text-slate-600";
}
