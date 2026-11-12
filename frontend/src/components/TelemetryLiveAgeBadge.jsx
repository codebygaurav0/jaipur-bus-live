import { useState, useEffect } from "react";
import { formatTelemetryAge } from "../telemetryAge";

export function TelemetryLiveAgeBadge({ timestamp }) {
  const [now, setNow] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span>
      {now === null ? "Update time unknown" : formatTelemetryAge(timestamp, now)}
    </span>
  );
}

export default TelemetryLiveAgeBadge;
