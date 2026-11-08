import { refresh } from "./actions";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <form action={refresh}>
      <button type="submit">Refresh</button>
    </form>
  );
}
