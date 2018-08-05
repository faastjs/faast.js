export class LogStitcher {
    lastLogEventTime = 0;
    seenIds = new Set<string>();

    updateEvent(timestamp: number | undefined, eventId: string | undefined) {
        if (timestamp) {
            if (timestamp > this.lastLogEventTime) {
                this.lastLogEventTime = timestamp;
                this.seenIds.clear();
            }
            if (eventId && timestamp === this.lastLogEventTime) {
                this.seenIds.add(eventId);
            }
        }
    }

    updateEvents<T>(
        entries: T[],
        getTimestamp: (event: T) => number | undefined,
        getId: (event: T) => string | undefined
    ) {
        if (entries.length > 0) {
            const last = entries[entries.length - 1];
            this.updateEvent(getTimestamp(last), getId(last));
            for (const entry of entries) {
                this.updateEvent(getTimestamp(entry), getId(entry));
            }
        }
    }

    has(id: string | undefined) {
        return typeof id === "string" && this.seenIds.has(id);
    }
}
