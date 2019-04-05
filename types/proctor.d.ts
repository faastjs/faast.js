declare module "process-doctor" {
    interface Result {
        time: number; // total time (= utime + stime)
        utime: number; // time spent in user space
        stime: number; // time spent in kernel space
        etime: number; // time elapsed since process started
        ptime: number; // CPU % of time (= putime + pstime)
        putime: number; // CPU % of utime
        pstime: number; // CPU % of stime
    }

    function lookup(pid: number, callback: (err: Error, result: Result) => void): void;

    const CLK_TCK: number;
}
