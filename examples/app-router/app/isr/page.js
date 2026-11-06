// ISR page that goes stale after 5 seconds; used to verify queue-triggered regeneration.
export const revalidate = 5;

export default function Page() {
  return <h1 id="t">isr {new Date().toISOString()}</h1>;
}
