import { FunctionStats } from "./provider";
import { SmallestN, Statistics } from "./shared";
import { PropertiesOfType } from "./types";

export class FactoryMap<K = string, V = {}> extends Map<K, V> {
    constructor(readonly factory: (key: K) => V) {
        super();
    }

    getOrCreate(key: K) {
        let val = this.get(key);
        if (!val) {
            val = this.factory(key);
            this.set(key, val);
        }
        return val;
    }
}

export class FunctionStatsMap {
    fIncremental = new FactoryMap(() => new FunctionStats());
    fAggregate = new FactoryMap(() => new FunctionStats());
    aggregate = new FunctionStats();

    update(
        fn: string,
        key: keyof PropertiesOfType<FunctionStats, Statistics>,
        value: number
    ) {
        this.fIncremental.getOrCreate(fn)[key].update(value);
        this.fAggregate.getOrCreate(fn)[key].update(value);
        this.aggregate[key].update(value);
    }

    incr(fn: string, key: keyof PropertiesOfType<FunctionStats, number>, n: number = 1) {
        this.fIncremental.getOrCreate(fn)[key] += n;
        this.fAggregate.getOrCreate(fn)[key] += n;
        this.aggregate[key] += n;
    }

    resetIncremental() {
        this.fIncremental.clear();
    }

    toString() {
        return [...this.fAggregate].map(([key, value]) => `[${key}] ${value}`).join("\n");
    }

    clear() {
        this.fIncremental.clear();
        this.fAggregate.clear();
    }
}

export class FunctionCpuUsage {
    utime = new Statistics();
    stime = new Statistics();
    cpuTime = new Statistics();
    smallest = new SmallestN(100);
}

class FunctionMemoryStats {
    rss = new Statistics();
    heapTotal = new Statistics();
    heapUsed = new Statistics();
    external = new Statistics();
}

class FunctionMemoryCounters {
    heapUsedGrowth = 0;
    externalGrowth = 0;
}

export class MemoryLeakDetector {
    private instances = new FactoryMap(() => new FunctionMemoryStats());
    private counters = new FactoryMap(() => new FunctionMemoryCounters());
    private warned = new Set<string>();
    private memorySize: number;

    constructor(memorySize?: number) {
        this.memorySize = memorySize || 100;
    }

    detectedNewLeak(fn: string, instanceId: string, memoryUsage: NodeJS.MemoryUsage) {
        if (this.warned.has(fn)) {
            return false;
        }
        const { rss, heapTotal, heapUsed, external } = memoryUsage;
        const instanceStats = this.instances.getOrCreate(instanceId);
        const counters = this.counters.getOrCreate(instanceId);
        if (heapUsed > instanceStats.heapUsed.max) {
            counters.heapUsedGrowth++;
        } else {
            counters.heapUsedGrowth = 0;
        }
        if (external > instanceStats.external.max) {
            counters.externalGrowth++;
        } else {
            counters.externalGrowth = 0;
        }
        instanceStats.rss.update(rss);
        instanceStats.heapTotal.update(heapTotal);
        instanceStats.heapUsed.update(heapUsed);
        instanceStats.external.update(external);

        if (
            heapUsed > this.memorySize * 0.8 * 2 ** 20 ||
            external > this.memorySize * 0.8 * 2 ** 20
        ) {
            if (counters.heapUsedGrowth > 4 || counters.externalGrowth > 4) {
                this.warned.add(fn);
                return true;
            }
        }
        return false;
    }

    clear() {
        this.instances.clear();
        this.counters.clear();
        this.warned.clear();
    }
}
