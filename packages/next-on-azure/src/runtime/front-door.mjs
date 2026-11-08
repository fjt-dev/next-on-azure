/** True when no Front Door id is configured, or the request carries it (any letter case). */
export function isFrontDoorRequestAllowed(expected, received) {
  if (!expected) return true;
  return (received ?? "").trim().toLowerCase() === expected.trim().toLowerCase();
}
