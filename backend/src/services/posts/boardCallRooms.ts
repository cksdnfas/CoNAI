/**
 * Board calls running now, by the chat room each runs in. A comment the called bot writes with its own tools during
 * that turn belongs to the call: it is the call's answer, and @calls in it continue the call's chain. The turn also
 * reads text other people wrote, so tool access narrows it (no private file tools; see toolAccess.ts).
 * Kept free of imports so tool access can ask without pulling in the posts services.
 */
const callsByRoom = new Map<number, { runId: number; profileId: number }>();

export const BoardCallRooms = {
  /** The call `runId` runs in `threadId` until the returned function is called. */
  bind(threadId: number, runId: number, profileId: number) {
    callsByRoom.set(threadId, { runId, profileId });
    return () => { if (callsByRoom.get(threadId)?.runId === runId) callsByRoom.delete(threadId); };
  },
  /** The call the bot `profileId` is answering in `threadId`, or null. */
  runFor(threadId: number, profileId: number): number | null {
    const call = callsByRoom.get(threadId);
    return call && call.profileId === profileId ? call.runId : null;
  },
};
