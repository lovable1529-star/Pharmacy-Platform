'use server';

/**
 * Opening hours.
 *
 * Every bookable slot in the system is derived from these windows. Without a
 * way to edit them the booking calendar can only ever show what a seed script
 * put there, which makes the whole scheduling module a demo rather than a
 * product — a pharmacy that changes its Saturday hours has to phone a developer.
 *
 * Windows are stored as weekday plus minutes-from-midnight, in the pharmacy's
 * own timezone. "Tuesdays, 9am to 5pm" is the thing the pharmacy actually
 * decides, and it stays true across daylight saving; a stored timestamp would
 * not.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { availability, branch, service } from '@/lib/db/schema';
import { getStaffContext } from '@/lib/auth/context';

export interface WindowRow {
  id: string;
  branchId: string;
  branchName: string;
  serviceId: string | null;
  serviceName: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  capacity: number;
}

export async function getOpeningHours(): Promise<{
  ok: boolean;
  windows?: WindowRow[];
  branches?: { id: string; name: string }[];
  services?: { id: string; name: string }[];
  error?: string;
}> {
  try {
    const { actor } = await getStaffContext();

    const [windows, branches, services] = await Promise.all([
      db
        .select({
          id: availability.id,
          branchId: availability.branchId,
          branchName: branch.name,
          serviceId: availability.serviceId,
          serviceName: service.name,
          weekday: availability.weekday,
          startMinute: availability.startMinute,
          endMinute: availability.endMinute,
          slotMinutes: availability.slotMinutes,
          capacity: availability.capacity,
        })
        .from(availability)
        .innerJoin(branch, eq(availability.branchId, branch.id))
        .leftJoin(service, eq(availability.serviceId, service.id))
        .where(
          and(
            eq(availability.organisationId, actor.organisationId),
            isNull(availability.archivedAt),
          ),
        )
        .orderBy(branch.name, availability.weekday, availability.startMinute),

      db
        .select({ id: branch.id, name: branch.name })
        .from(branch)
        .where(
          and(eq(branch.organisationId, actor.organisationId), isNull(branch.archivedAt)),
        )
        .orderBy(branch.name),

      db
        .select({ id: service.id, name: service.name })
        .from(service)
        .where(
          and(
            eq(service.organisationId, actor.organisationId),
            isNull(service.archivedAt),
          ),
        )
        .orderBy(service.name),
    ]);

    return { ok: true, windows, branches, services };
  } catch (error) {
    console.error('getOpeningHours failed', error);
    return { ok: false, error: 'Could not load opening hours.' };
  }
}

export interface SaveWindowInput {
  id: string | null;
  branchId: string;
  serviceId: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  capacity: number;
}

function validate(input: SaveWindowInput): string | null {
  if (input.weekday < 0 || input.weekday > 6) return 'That is not a valid day.';
  if (input.startMinute < 0 || input.endMinute > 24 * 60) {
    return 'Times must fall within a single day.';
  }
  if (input.endMinute <= input.startMinute) {
    return 'The closing time must be after the opening time.';
  }
  if (input.slotMinutes < 5 || input.slotMinutes > 240) {
    return 'Appointment length must be between 5 and 240 minutes.';
  }
  // A window shorter than one slot generates nothing, which looks like the
  // system silently ignoring what you saved.
  if (input.endMinute - input.startMinute < input.slotMinutes) {
    return 'That window is shorter than one appointment.';
  }
  if (input.capacity < 1 || input.capacity > 50) {
    return 'Capacity must be between 1 and 50.';
  }
  return null;
}

const save = action<SaveWindowInput>('settings:edit')
  .scopedTo((input) => ({ branchId: input.branchId }))
  .handler(async (input, { tx, actor }) => {
    if (input.id) {
      const [updated] = await tx
        .update(availability)
        .set({
          branchId: input.branchId,
          serviceId: input.serviceId,
          weekday: input.weekday,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          slotMinutes: input.slotMinutes,
          capacity: input.capacity,
        })
        .where(eq(availability.id, input.id))
        .returning({ id: availability.id });

      if (!updated) throw new Error('That window no longer exists.');

      return {
        result: { id: updated.id },
        audit: {
          action: 'availability.updated',
          entityType: 'availability',
          entityId: updated.id,
          after: { ...input },
        },
      };
    }

    const [created] = await tx
      .insert(availability)
      .values({
        organisationId: actor.organisationId,
        branchId: input.branchId,
        serviceId: input.serviceId,
        weekday: input.weekday,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        slotMinutes: input.slotMinutes,
        capacity: input.capacity,
      })
      .returning({ id: availability.id });

    if (!created) throw new Error('Could not save that window.');

    return {
      result: { id: created.id },
      audit: {
        action: 'availability.created',
        entityType: 'availability',
        entityId: created.id,
        after: { ...input },
      },
    };
  });

export async function saveOpeningWindow(input: SaveWindowInput) {
  const problem = validate(input);
  if (problem) return { ok: false as const, error: problem };

  try {
    await save(input);
    revalidatePath('/settings/hours');
    revalidatePath('/appointments');
    return { ok: true as const };
  } catch (error) {
    console.error('saveOpeningWindow failed', error);
    return { ok: false as const, error: message(error) };
  }
}

const remove = action<{ id: string; branchId: string }>('settings:edit')
  .scopedTo((input) => ({ branchId: input.branchId }))
  .handler(async (input, { tx }) => {
    // Archived, never deleted. Appointments already booked inside this window
    // must keep making sense when someone looks at them next year.
    const [archived] = await tx
      .update(availability)
      .set({ archivedAt: new Date() })
      .where(eq(availability.id, input.id))
      .returning({ id: availability.id });

    if (!archived) throw new Error('That window no longer exists.');

    return {
      result: { id: archived.id },
      audit: {
        action: 'availability.archived',
        entityType: 'availability',
        entityId: archived.id,
      },
    };
  });

export async function removeOpeningWindow(id: string, branchId: string) {
  try {
    await remove({ id, branchId });
    revalidatePath('/settings/hours');
    revalidatePath('/appointments');
    return { ok: true as const };
  } catch (error) {
    console.error('removeOpeningWindow failed', error);
    return { ok: false as const, error: message(error) };
  }
}

function message(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AuthorisationError') {
      return 'You do not have permission to change opening hours.';
    }
    return error.message;
  }
  return 'Something went wrong.';
}
