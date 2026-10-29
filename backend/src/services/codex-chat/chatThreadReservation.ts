/** Threads being removed cannot accept new replies while their previous work is stopping. */
export const deletingThreads = new Set<number>()
