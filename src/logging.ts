export class LogStreamer {
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

    has(id: string | undefined) {
        return typeof id === "string" && this.seenIds.has(id);
    }
}
