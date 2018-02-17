const Docker = require('dockerode');
const Logr = require('logr');
const logrFlat = require('logr-flat');
const hostname = require('os').hostname();
const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

const log = Logr.createLogger({
  reporters: {
    flat: {
      reporter: logrFlat,
      options: {
        appColor: true
      }
    }
  }
});

const containers = {};

const logContainer = (container, value, options) => {
  // verbose mode logs usage stats on every interval:
  if (options.verbose) {
    log([container.name, hostname, 'cpu', 'info'], `Using ${value}% CPU capacity`);
  }
  // we always notify if a container has exceeded its threshold for too many intervals
  // or when it goes back below that threshold
  const containerInfo = containers[container.id];
  if (value < options.cpuThreshold) {
    if (containerInfo.intervals > options.intervalsAllowed) {
      log([container.name, hostname, 'cpu', 'restored', 'threshold'], `CPU is now at ${value}%`);
    }
    containerInfo.intervals = 0;
  } else {
    containerInfo.intervals ++;
    if (containerInfo.intervals > options.intervalsAllowed) {
      log([container.name, hostname, 'cpu', 'warning', 'threshold'], `CPU usage has been at ${value}% for ${containerInfo.intervals * options.interval} seconds`);
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
  logContainer(container, cpuPercent, options);
  // update the previous cpu values:
  containers[container.id].previousCPU = cpuStats.cpu_usage.total_usage;
  containers[container.id].previousSystem = cpuStats.system_cpu_usage;
};

// the main processing loop:
const runInterval = async(docker, options) => {
  // list all running containers:
  const containerDescriptions = await docker.listContainers({ filters: { status: ['running'] } });
  // get and print stats for each running container:
  // todo: this can be made faster with Promise.all():
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
  log([hostname, 'docker-ops', 'info'], `Interval length is ${options.interval}, threshold is ${options.cpuThreshold}% and containers can be above threshold for ${options.intervalsAllowed} intervals`);
  // only need to create the dockerode object once:
  const docker = new Docker();
  runInterval(docker, options);
};
