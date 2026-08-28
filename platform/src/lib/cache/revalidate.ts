import { revalidatePath } from 'next/cache';

/**
 * Drop every cached staff view.
 *
 * The staff screens are not independent. Marking a patient as arrived changes
 * Appointments, the Today snapshot, and the waiting count; approving a repeat
 * request changes Repeat care AND the badge in the sidebar, which is rendered
 * by the shared layout and therefore appears on every page at once.
 *
 * Before client-side route caching was enabled this mostly did not show,
 * because every navigation re-rendered on the server anyway. With a stale time
 * it shows immediately, and it shows as the exact bug reported from the floor
 * earlier in this project: mark someone arrived, open Consultations, and find
 * it empty. The fix then was to link the records; the fix now is to make sure a
 * mutation invalidates the pages it actually affects rather than only the one
 * the user happened to be standing on.
 *
 * `'layout'` on `'/'` is deliberately the blunt instrument. Enumerating which
 * screens each mutation touches is exactly the bookkeeping that rots — someone
 * adds a count to the sidebar and six actions silently become wrong. Staff
 * mutate rarely and navigate constantly, so paying a full invalidation per
 * mutation to keep every navigation both instant and correct is the right side
 * of that trade.
 *
 * Call this INSTEAD of a narrow `revalidatePath`, not in addition to one. Keep
 * the narrow call only for a specific record page — `/patients/[id]` — where
 * the point is to refresh that one row's own screen.
 */
export function revalidateStaffViews(): void {
  revalidatePath('/', 'layout');
}
