const Docker = require('dockerode');

const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

const containers = {};

// log when we go over threshold or when we go back under threshold:
const logThresholdExceeded = (container, value, options) => {
  const containerInfo = containers[container.id];
  if (value < options.cpuThreshold) {
    if (containerInfo.intervals > options.intervalsAllowed) {
      console.log(`OKAY: Container ${container.name} CPU is now at ${value}%`);
    }
    containerInfo.intervals = 0;
  } else {
    containerInfo.intervals ++;
    if (containerInfo.intervals > options.intervalsAllowed) {
      console.log(`WARNING: Container ${container.name} has been at ${value}% CPU Usage for ${containerInfo.intervals * options.interval} seconds`);
    }
  }
};

const printStats = (container, stats, options) => {
  // get cpu usage stats:
  const cpuStats = stats.cpu_stats;
  const cpuDelta = cpuStats.cpu_usage.total_usage - containers[container.id].previousCPU;
  const systemDelta = cpuStats.system_cpu_usage - containers[container.id].previousSystem;
  const cpuCount = cpuStats.cpu_usage.percpu_usage.length;
  const cpuPercent = ((cpuDelta / systemDelta) * cpuCount * 100.0).toFixed(0);
  // now log as appropriate.  verbose mode just always logs usage stats:
  if (options.verbose) {
    console.log(`Container ${container.name} is using ${cpuPercent}% of its CPU capacity`);
  } else {
    // outside of verbose mode, only log if a container has exceeded its threshold for x intervals:
    logThresholdExceeded(container, cpuPercent, options);
  }
  // update the previous cpu values:
  containers[container.id].previousCPU = cpuStats.cpu_usage.total_usage;
  containers[container.id].previousSystem = cpuStats.system_cpu_usage;
};

// the main processing loop:
const runInterval = async(docker, options) => {
  // list all running containers:
  const containerDescriptions = await docker.listContainers({ filters: { status: ['running'] } });
  // get and print stats for each running container:
  // todo: should this be a Promise.all()?
  containerDescriptions.forEach(async containerDescription => {
    const container = docker.getContainer(containerDescription.Id);
    container.name = containerDescription.Names.length > 0 ? containerDescription.Names[0] : 'unknown';
    const stats = await container.stats({ stream: false });
    // initialize some data for the container the first time we see it:
    if (!containers[container.id]) {
      containers[container.id] = {
        previousCPU: 0,
        previousSystem: 0,
        intervals: 0
      };
    }
    printStats(container, stats, options);
  });
  // wait for x seconds and then do it again:
  await wait(options.interval);
  runInterval(docker, options);
};

module.exports.start = (options) => {
  // only need to create the dockerode object once:
  const docker = new Docker();
  runInterval(docker, options);
};
