/* ══════════════════════════════════════════════════════════════════
   src/api/paymentPage.js

   Raw read of a project's payment page.

   dashboardExtras already fetches this endpoint, but normalizes it down
   to headline totals and throws the per-term detail away. The SLA
   payable report needs the terms themselves — milestoneId, value,
   ldBasisValue and the activity split — so it reads the payload raw.

   The endpoint is permission-gated: a user without finance access gets
   403. That is a legitimate outcome for someone looking at SLAs, not a
   failure, so `isFinanceForbidden` lets the caller degrade to "no
   finance access" instead of showing an error.
   ══════════════════════════════════════════════════════════════════ */
import { api } from "./client";
import { ENDPOINTS } from "./endpoint";

export async function getPaymentPage(projectId) {
    if (!projectId) return null;
    const res = await api.get(ENDPOINTS.projects.paymentPage(projectId));
    return res?.data ?? res;
}

// Mirrors the check ProjectFinancePage makes — the service is not
// consistent about whether the 403 arrives as a status or as a message.
export function isFinanceForbidden(err) {
    return err?.status === 403 || /permission denied|do not have access/i.test(err?.message || "");
}
