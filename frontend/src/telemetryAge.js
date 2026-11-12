export function formatTelemetryAge(timestamp, now = Date.now()) {
  const timestampMs =
    typeof timestamp === "number" ? timestamp : Date.parse(timestamp || "");
  if (!Number.isFinite(timestampMs) || !Number.isFinite(now)) {
    return "Update time unknown";
  }

  const seconds = Math.max(0, Math.floor((now - timestampMs) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
