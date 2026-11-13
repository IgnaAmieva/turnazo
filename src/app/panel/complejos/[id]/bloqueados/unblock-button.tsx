"use client";

import { useActionState } from "react";
import { unblockPhoneAction } from "@/app/actions/panel";
import type { PanelActionState } from "@/app/actions/panel";

export function UnblockButton({ venueId, phone }: { venueId: string; phone: string }) {
  const [state, formAction, pending] = useActionState<PanelActionState, FormData>(
    unblockPhoneAction,
    null
  );

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="phone" value={phone} />
      {state?.error && <span className="mr-2 text-xs text-red-600">{state.error}</span>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
      >
        {pending ? "Desbloqueando…" : "Desbloquear"}
      </button>
    </form>
  );
}
