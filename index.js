const Docker = require('dockerode');
const Logr = require('logr');
const logrFlat = require('logr-flat');
const logrSlack = require('logr-slack');
const hostname = require('os').hostname();
const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

let log;

const reporters = {
  flat: {
    reporter: logrFlat,
    options: {
      appColor: true,
      timestamp: false,
      tagColors: {
        restored: 'green'
      }
    }
  }
};

const containers = {};

const logContainerCpu = (container, value, options) => {
  // verbose mode logs usage stats on every interval:
  if (options.verbose) {
    log([container.name, hostname, 'cpu', 'info'], `Using ${value}% CPU capacity`);
  }
  // we always notify if a container has exceeded its threshold for too many intervals
  // or when it goes back below that threshold
  const containerInfo = containers[container.id];
  if (value < options.cpuThreshold) {
    if (containerInfo.cpuIntervals > options.intervalsAllowed) {
      log([container.name, hostname, 'cpu', 'restored', 'threshold'], `CPU has dropped below critical threshold and is now at ${value}%`);
    }
    containerInfo.cpuIntervals = 0;
  } else {
    containerInfo.cpuIntervals ++;
    if (containerInfo.cpuIntervals > options.intervalsAllowed) {
      log([container.name, hostname, 'cpu', 'warning', 'threshold'], `CPU usage has been at ${value}% for ${containerInfo.cpuIntervals * options.interval} seconds`);
    }
  }
};

const logContainerMemory = (container, value, options) => {
  // verbose mode logs usage stats on every interval:
  if (options.verbose) {
    log([container.name, hostname, 'memory', 'info'], `Using ${value}% memory capacity`);
  }
  // we always notify if a container has exceeded its threshold for too many intervals
  // or when it goes back below that threshold
  const containerInfo = containers[container.id];
  if (value < options.memThreshold) {
    if (containerInfo.memIntervals > options.intervalsAllowed) {
      log([container.name, hostname, 'memory', 'restored', 'threshold'], `Memory has dropped below critical threshold and is now at ${value}%`);
    }
    containerInfo.memIntervals = 0;
  } else {
    containerInfo.memIntervals ++;
    if (containerInfo.memIntervals > options.intervalsAllowed) {
      log([container.name, hostname, 'memory', 'warning', 'threshold'], `Memory usage has been at ${value}% for ${containerInfo.memIntervals * options.interval} seconds`);
    }
  }
};

const printStats = (container, stats, options) => {
  // get cpu usage stats:
  const cpuStats = stats.cpu_stats;
  const cpuDelta = cpuStats.cpu_usage.total_usage - containers[container.id].previousCPU;
  const systemDelta = cpuStats.system_cpu_usage - containers[container.id].previousSystem;
  if (!cpuStats.cpu_usage.percpu_usage) {
    return log(['cpu', 'info'], `cpu usage information was not available for ${container.name}`);
  }
  const cpuCount = cpuStats.cpu_usage.percpu_usage.length;
  // if systemDelta or cpuDelta are 0, cpuPercent is just 0. Otherwise calculate the usage
  const cpuPercent = systemDelta === 0 || cpuDelta === 0 ? 0 : ((cpuDelta / systemDelta) * cpuCount * 100.0).toFixed(2);
  logContainerCpu(container, cpuPercent, options);
  // get memory usage stats:
  const memStats = stats.memory_stats;
  const memPercent = ((memStats.usage / memStats.limit) * 100.0).toFixed(2);
  logContainerMemory(container, memPercent, options);
  // update the previous cpu/mem values:
  containers[container.id].previousCPU = cpuStats.cpu_usage.total_usage;
  containers[container.id].previousSystem = cpuStats.system_cpu_usage;
};

// the main processing loop:
const runInterval = async(docker, options) => {
  try {
    // list all running containers:
    const containerDescriptions = await docker.listContainers({ filters: { status: ['running'] } });
    // get and print stats for each running container:
    // todo: should this be a Promise.all()?
    containerDescriptions.forEach(async containerDescription => {
      const container = docker.getContainer(containerDescription.Id);
      container.name = (containerDescription.Names && containerDescription.Names.length > 0) ? containerDescription.Names[0] : `${containerDescription.Id} (name unknown)`;
      if (container.name.startsWith('/')) {
        container.name = container.name.replace('/', '');
      }
      if (options.exclude) {
        if (RegExp(options.exclude).test(container.name)) {
          return;
        }
      }
      const stats = await container.stats({ stream: false });
      // initialize some data for the container the first time we see it:
      if (!containers[container.id]) {
        containers[container.id] = {
          previousCPU: 0,
          previousSystem: 0,
          cpuIntervals: 0,
          memIntervals: 0
        };
      }
      if (!stats) {
        return log(['docker-ops', 'warning'], `Failed to get stats for container ${container.name}`);
      }
      printStats(container, stats, options);
    });
  } catch (e) {
    // if there was an error at any point, log it:
    log(e);
  } finally {
    // wait for x seconds and then do it again:
    await wait(options.interval);
    runInterval(docker, options);
  }
};
module.exports.start = (options) => {
  if (options.slackHook) {
    reporters.slack = {
      reporter: logrSlack,
      options: {
        slackHook: options.slackHook,
        filter: ['warning', 'restored'],
        username: options.name ? `Ops - ${options.name}` : 'Ops',
        iconEmoji: options.emoji,
        hideTags: true,
        tagColors: {
          warning: 'warning',
          restored: 'good'
        },
        throttle: options.slackReportRate * 1000,
        throttleBasedOnTags: true,
      }
    };
  }
  log = Logr.createLogger({ reporters });
  log([hostname, 'docker-ops', 'info'], `Interval length: ${options.interval}, CPU threshold: ${options.cpuThreshold}% Memory threshold: ${options.memThreshold}%. Containers can be above threshold for ${options.intervalsAllowed} intervals`);
  // only need to create the dockerode object once:
  const docker = new Docker();
  runInterval(docker, options);
};
