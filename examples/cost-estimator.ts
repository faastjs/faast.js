import {
    CloudProvider,
    CommonOptions,
    CostBreakdown,
    create,
    Promisified,
    aws,
    google,
    FunctionStats
} from "../src/cloudify";
import { BoundedFunnel } from "../src/funnel";
import { log } from "../src/log";
import * as funcs from "../test-slow/functions";
import { inspect } from "util";
import { Statistics } from "../src/shared";

type Options = CommonOptions | aws.Options | google.Options;

interface CostEstimatorConfiguration {
    cloudProvider: "aws" | "google";
    useQueue: boolean[];
    repetitions: number;
    memorySizes: number[];
    options: Options[];
    concurrency: number;
}

export const AWSLambdaMemorySizes = (() => {
    const rv = [];
    for (let memorySize = 128; memorySize <= 3008; memorySize += 64) {
        rv.push(memorySize);
    }
    return rv;
})();

export const GoogleCloudFunctionsMemorySizes = [128, 256, 512, 1024, 2048];

export const CommonMemorySizes = GoogleCloudFunctionsMemorySizes.filter(size =>
    AWSLambdaMemorySizes.find(asize => asize === size)
);

export const defaultAwsConfiguration: CostEstimatorConfiguration = {
    cloudProvider: "aws",
    useQueue: [true, false],
    repetitions: 1,
    memorySizes: AWSLambdaMemorySizes,
    options: [{}],
    concurrency: 1
};

export const defaulGoogleConfiguration: CostEstimatorConfiguration = {
    cloudProvider: "google",
    useQueue: [true, false],
    repetitions: 1,
    memorySizes: GoogleCloudFunctionsMemorySizes,
    options: [{}],
    concurrency: 1
};

interface CostEstimateProfile {
    cloudProvider: string;
    options: Options;
    costEstimate: CostBreakdown;
    stats: FunctionStats;
}

async function estimate<T>(
    cloudProvider: CloudProvider,
    fmodule: string,
    workload: (module: Promisified<T>) => Promise<void>,
    repetitions: number,
    concurrency: number,
    options: Options
): Promise<CostEstimateProfile> {
    const cloud = create(cloudProvider);
    const cloudFunction = await cloud.createFunction(fmodule, options);
    const remote = cloudFunction.cloudifyAll(require(fmodule)) as Promisified<T>;
    const funnel = new BoundedFunnel({ maxConcurrency: concurrency });
    const results = [];
    for (let i = 0; i < repetitions; i++) {
        // results.push(workload(remote));
        await workload(remote);
    }
    // await Promise.all(results);
    await cloudFunction.cleanup();
    return {
        cloudProvider,
        options,
        costEstimate: await cloudFunction.costEstimate(),
        stats: cloudFunction.functionStats.aggregate
    };
}

async function runConfig<T>(
    fmodule: string,
    workload: (remote: Promisified<T>) => Promise<void>,
    config: CostEstimatorConfiguration
) {
    const funnel = new BoundedFunnel<CostEstimateProfile>({
        maxConcurrency: 5,
        targetRequestsPerSecond: 2,
        maxBurst: 1
    });
    config.memorySizes.forEach(memorySize =>
        config.useQueue.forEach(useQueue =>
            config.options.forEach(options =>
                funnel.push(() =>
                    estimate(
                        config.cloudProvider,
                        fmodule,
                        workload,
                        config.repetitions,
                        config.concurrency,
                        {
                            memorySize,
                            useQueue,
                            ...(options as any)
                        }
                    )
                )
            )
        )
    );
    const results = await funnel.all();
    results.forEach(result => log(`${result.costEstimate}`));
    return results;
}

async function costEstimator<T>(
    fmodule: string,
    workload: (remote: Promisified<T>) => Promise<void>,
    configurations: CostEstimatorConfiguration[] = [defaultAwsConfiguration]
) {
    const allConfigs = await Promise.all(
        configurations.map(config => runConfig(fmodule, workload, config))
    );
    let results: CostEstimateProfile[] = [];
    results = results.concat(...allConfigs);
    results.sort(
        (a, b) => a.costEstimate.estimateTotal() - b.costEstimate.estimateTotal()
    );

    return results;
}

async function work(remote: Promisified<typeof funcs>) {
    await remote.monteCarloPI(2000000);
}

function toCSV(profile: CostEstimateProfile[]) {
    const p = (stat: Statistics) => (stat.mean / 1000).toFixed(3);
    let rv = "";
    rv += `cloud,memory,useQueue,options,cost,executionLatency,billedTime\n`;
    profile.forEach(r => {
        const { memorySize, useQueue, ...rest } = r.options;
        const total = r.costEstimate.estimateTotal().toFixed(8);
        const restStr = `"${inspect(rest).replace('"', '""')}"`;
        rv += `${r.cloudProvider},${memorySize},${useQueue},${restStr},$${total},${p(
            r.stats.executionLatencyMs
        )},${p(r.stats.estimatedBilledTimeMs)}\n`;
    });
    return rv;
}

async function main() {
    // costEstimator("../test-slow/functions", work);

    const profile = await costEstimator("../test-slow/functions", work, [
        { ...defaultAwsConfiguration, repetitions: 100 }
    ]);

    console.log(toCSV(profile));
}

main();

// cloud,memory,useQueue,options,cost,executionLatency,billedTime
// aws,1216,false,"{}",$0.00004398,0.2,0.2
// aws,1280,false,"{}",$0.00004408,0.2,0.2
// aws,832,false,"{}",$0.00004439,0.3,0.3
// aws,768,false,"{}",$0.00004492,0.3,0.3
// aws,1344,false,"{}",$0.00004617,0.2,0.2
// aws,256,false,"{}",$0.00004617,1.0,1.1
// aws,896,false,"{}",$0.00004617,0.3,0.3
// aws,384,false,"{}",$0.00004679,0.7,0.7
// aws,128,false,"{}",$0.00004721,2.1,2.2
// aws,192,false,"{}",$0.00004742,1.4,1.4
// aws,1408,false,"{}",$0.00004825,0.2,0.2
// aws,704,false,"{}",$0.00004825,0.4,0.4
// aws,320,false,"{}",$0.00004877,0.8,0.9
// aws,512,false,"{}",$0.00004908,0.5,0.6
// aws,576,false,"{}",$0.00004929,0.4,0.5
// aws,960,false,"{}",$0.00004929,0.2,0.3
// aws,1152,false,"{}",$0.00004929,0.2,0.3
// aws,1472,false,"{}",$0.00005033,0.2,0.2
// aws,448,false,"{}",$0.00005054,0.6,0.7
// aws,640,false,"{}",$0.00005137,0.4,0.5
// aws,1024,false,"{}",$0.00005242,0.2,0.3
// aws,1600,false,"{}",$0.00005450,0.2,0.2
// aws,1536,false,"{}",$0.00005492,0.2,0.2
// aws,1088,false,"{}",$0.00005554,0.2,0.3
// aws,1664,false,"{}",$0.00005658,0.1,0.2
// aws,1728,false,"{}",$0.00005867,0.1,0.2
// aws,1792,false,"{}",$0.00006075,0.1,0.2
// aws,1856,false,"{}",$0.00006283,0.1,0.2
// aws,1920,false,"{}",$0.00006492,0.1,0.2
// aws,1984,false,"{}",$0.00006700,0.1,0.2
// aws,2048,false,"{}",$0.00006908,0.1,0.2
// aws,2112,false,"{}",$0.00007117,0.1,0.2
// aws,2176,false,"{}",$0.00007325,0.1,0.2
// aws,256,true,"{}",$0.00007503,1.0,1.4
// aws,2240,false,"{}",$0.00007533,0.1,0.2
// aws,320,true,"{}",$0.00007702,0.8,1.1
// aws,2304,false,"{}",$0.00007742,0.1,0.2
// aws,512,true,"{}",$0.00007754,0.5,0.7
// aws,576,true,"{}",$0.00007847,0.4,0.7
// aws,768,true,"{}",$0.00007919,0.3,0.5
// aws,384,true,"{}",$0.00007941,0.7,1.0
// aws,2368,false,"{}",$0.00007950,0.1,0.2
// aws,128,true,"{}",$0.00007984,2.1,2.8
// aws,192,true,"{}",$0.00008004,1.3,1.9
// aws,704,true,"{}",$0.00008024,0.4,0.5
// aws,1280,true,"{}",$0.00008044,0.2,0.3
// aws,960,true,"{}",$0.00008076,0.2,0.4
// aws,448,true,"{}",$0.00008119,0.6,0.8
// aws,2432,false,"{}",$0.00008158,0.1,0.2
// aws,640,true,"{}",$0.00008171,0.4,0.6
// aws,832,true,"{}",$0.00008221,0.3,0.5
// aws,1024,true,"{}",$0.00008336,0.2,0.4
// aws,2496,false,"{}",$0.00008367,0.1,0.2
// aws,1344,true,"{}",$0.00008399,0.2,0.3
// aws,896,true,"{}",$0.00008483,0.3,0.5
// aws,2560,false,"{}",$0.00008575,0.1,0.2
// aws,2624,false,"{}",$0.00008783,0.1,0.2
// aws,1472,true,"{}",$0.00008905,0.2,0.3
// aws,1408,true,"{}",$0.00008963,0.2,0.3
// aws,2688,false,"{}",$0.00008992,0.1,0.2
// aws,1088,true,"{}",$0.00009023,0.2,0.4
// aws,1216,true,"{}",$0.00009190,0.2,0.4
// aws,2752,false,"{}",$0.00009200,0.1,0.2
// aws,1600,true,"{}",$0.00009315,0.1,0.3
// aws,1152,true,"{}",$0.00009357,0.2,0.4
// aws,2816,false,"{}",$0.00009408,0.1,0.2
// aws,1536,true,"{}",$0.00009468,0.2,0.3
// aws,2880,false,"{}",$0.00009617,0.1,0.2
// aws,1664,true,"{}",$0.00009627,0.1,0.3
// aws,2944,false,"{}",$0.00009825,0.1,0.2
// aws,1728,true,"{}",$0.00009909,0.1,0.3
// aws,3008,false,"{}",$0.00010033,0.1,0.2
// aws,1984,true,"{}",$0.00010197,0.1,0.3
// aws,1856,true,"{}",$0.00010565,0.1,0.3
// aws,1792,true,"{}",$0.00010587,0.1,0.3
// aws,1920,true,"{}",$0.00011045,0.1,0.3
// aws,2048,true,"{}",$0.00011087,0.1,0.3
// aws,2112,true,"{}",$0.00011815,0.1,0.3
// aws,2176,true,"{}",$0.00012127,0.1,0.3
// aws,2240,true,"{}",$0.00012410,0.1,0.3
// aws,2304,true,"{}",$0.00012836,0.1,0.3
// aws,2368,true,"{}",$0.00013065,0.1,0.3
// aws,2432,true,"{}",$0.00013628,0.1,0.3
// aws,2496,true,"{}",$0.00013786,0.1,0.3
// aws,2688,true,"{}",$0.00014422,0.1,0.3
// aws,2560,true,"{}",$0.00014588,0.1,0.3
// aws,2752,true,"{}",$0.00014630,0.1,0.3
// aws,2624,true,"{}",$0.00014817,0.1,0.3
// aws,2816,true,"{}",$0.00015671,0.1,0.3
// aws,2880,true,"{}",$0.00016067,0.1,0.3
// aws,2944,true,"{}",$0.00016379,0.1,0.3
// aws,3008,true,"{}",$0.00016524,0.1,0.3

// cloud,memory,useQueue,options,cost,executionLatency,billedTime
// aws,1216,false,"{}",$0.00004398,0.192,0.210
// aws,1280,false,"{}",$0.00004408,0.182,0.200
// aws,832,false,"{}",$0.00004439,0.285,0.310
// aws,896,false,"{}",$0.00004617,0.261,0.300
// aws,1344,false,"{}",$0.00004617,0.174,0.200
// aws,320,false,"{}",$0.00004617,0.797,0.840
// aws,128,false,"{}",$0.00004679,2.067,2.130
// aws,192,false,"{}",$0.00004710,1.384,1.430
// aws,768,false,"{}",$0.00004742,0.314,0.360
// aws,384,false,"{}",$0.00004742,0.670,0.720
// aws,256,false,"{}",$0.00004742,1.032,1.080
// aws,512,false,"{}",$0.00004742,0.503,0.540
// aws,448,false,"{}",$0.00004762,0.580,0.620
// aws,1408,false,"{}",$0.00004825,0.169,0.200
// aws,704,false,"{}",$0.00004825,0.364,0.400
// aws,640,false,"{}",$0.00004929,0.406,0.450
// aws,960,false,"{}",$0.00004929,0.243,0.300
// aws,576,false,"{}",$0.00004929,0.447,0.500
// aws,1472,false,"{}",$0.00005033,0.161,0.200
// aws,1152,false,"{}",$0.00005117,0.207,0.260
// aws,1024,false,"{}",$0.00005242,0.231,0.300
// aws,1536,false,"{}",$0.00005242,0.160,0.200
// aws,1600,false,"{}",$0.00005450,0.148,0.200
// aws,1088,false,"{}",$0.00005554,0.220,0.300
// aws,1664,false,"{}",$0.00005658,0.148,0.200
// aws,1728,false,"{}",$0.00005867,0.147,0.200
// aws,1792,false,"{}",$0.00006075,0.142,0.200
// aws,1856,false,"{}",$0.00006283,0.147,0.200
// aws,1920,false,"{}",$0.00006492,0.143,0.200
// aws,1984,false,"{}",$0.00006700,0.148,0.200
// aws,2048,false,"{}",$0.00006908,0.144,0.200
// aws,2112,false,"{}",$0.00007117,0.147,0.200
// aws,2176,false,"{}",$0.00007325,0.144,0.200
// aws,512,true,"{}",$0.00007335,0.499,0.700
// aws,320,true,"{}",$0.00007471,0.805,1.130
// aws,192,true,"{}",$0.00007524,1.331,1.820
// aws,2240,false,"{}",$0.00007533,0.147,0.200
// aws,256,true,"{}",$0.00007545,0.999,1.370
// aws,128,true,"{}",$0.00007713,2.023,2.700
// aws,2304,false,"{}",$0.00007742,0.149,0.200
// aws,704,true,"{}",$0.00007773,0.357,0.540
// aws,448,true,"{}",$0.00007827,0.568,0.810
// aws,640,true,"{}",$0.00007836,0.402,0.600
// aws,384,true,"{}",$0.00007899,0.666,0.970
// aws,576,true,"{}",$0.00007921,0.443,0.640
// aws,2368,false,"{}",$0.00007950,0.148,0.200
// aws,960,true,"{}",$0.00008065,0.234,0.420
// aws,768,true,"{}",$0.00008087,0.297,0.500
// aws,2432,false,"{}",$0.00008158,0.148,0.200
// aws,1216,true,"{}",$0.00008201,0.192,0.330
// aws,896,true,"{}",$0.00008356,0.263,0.470
// aws,2496,false,"{}",$0.00008367,0.144,0.200
// aws,1344,true,"{}",$0.00008399,0.167,0.300
// aws,2560,false,"{}",$0.00008575,0.150,0.200
// aws,1280,true,"{}",$0.00008585,0.177,0.340
// aws,832,true,"{}",$0.00008608,0.279,0.500
// aws,1024,true,"{}",$0.00008671,0.224,0.400
// aws,2624,false,"{}",$0.00008783,0.145,0.200
// aws,1152,true,"{}",$0.00008794,0.200,0.380
// aws,1408,true,"{}",$0.00008796,0.160,0.300
// aws,1472,true,"{}",$0.00008941,0.159,0.300
// aws,2688,false,"{}",$0.00008992,0.141,0.200
// aws,2752,false,"{}",$0.00009200,0.146,0.200
// aws,2816,false,"{}",$0.00009408,0.146,0.200
// aws,1088,true,"{}",$0.00009442,0.213,0.420
// aws,1536,true,"{}",$0.00009503,0.152,0.310
// aws,1856,true,"{}",$0.00009524,0.133,0.260
// aws,2880,false,"{}",$0.00009617,0.149,0.200
// aws,1600,true,"{}",$0.00009649,0.148,0.300
// aws,2944,false,"{}",$0.00009825,0.143,0.200
// aws,1728,true,"{}",$0.00009940,0.146,0.300
// aws,1664,true,"{}",$0.00009962,0.144,0.300
// aws,3008,false,"{}",$0.00010033,0.147,0.200
// aws,1792,true,"{}",$0.00010336,0.138,0.300
// aws,1920,true,"{}",$0.00010864,0.142,0.290
// aws,1984,true,"{}",$0.00011273,0.143,0.300
// aws,2048,true,"{}",$0.00011586,0.141,0.300
// aws,2176,true,"{}",$0.00012378,0.143,0.300
// aws,2304,true,"{}",$0.00012836,0.148,0.300
// aws,2240,true,"{}",$0.00012942,0.142,0.300
// aws,2368,true,"{}",$0.00013148,0.144,0.300
// aws,2112,true,"{}",$0.00013273,0.141,0.340
// aws,2432,true,"{}",$0.00013461,0.143,0.300
// aws,2496,true,"{}",$0.00013941,0.143,0.300
// aws,2560,true,"{}",$0.00014002,0.141,0.300
// aws,2624,true,"{}",$0.00014482,0.141,0.300
// aws,2688,true,"{}",$0.00014627,0.142,0.300
// aws,2816,true,"{}",$0.00015252,0.142,0.300
// aws,2752,true,"{}",$0.00015274,0.142,0.300
// aws,2880,true,"{}",$0.00015648,0.142,0.300
// aws,2944,true,"{}",$0.00015961,0.144,0.300
// aws,3008,true,"{}",$0.00019056,0.143,0.350
