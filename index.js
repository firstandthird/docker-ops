const Docker = require('dockerode');
const Logr = require('logr');
const logrFlat = require('logr-flat');
const logrSlack = require('logr-slack');
const hostname = require('os').hostname();
const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

let log;
let started = false;

const addValue = (value, previousValues) => {
  // remove outdated values:
  const now = new Date().getTime();
  const oneMinuteAgo = now - 60000;
  previousValues[now] = value;
  Object.keys(previousValues).forEach(timestamp => {
    if (timestamp < oneMinuteAgo) {
      delete previousValues[timestamp];
    }
  });
};

const getAverage = (previousValues) => {
  let valueSum = 0;
  Object.keys(previousValues).forEach(timestamp => {
    valueSum += Number(previousValues[timestamp]);
  });
  return (valueSum / Object.keys(previousValues).length).toFixed(2);
};

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
  const containerInfo = containers[container.id];
  // don't start issuing cpu warnings until we have 1 minute of data:
  if (new Date().getTime() < started + 60000) {
    return;
  }
  if (value < options.cpuThreshold) {
    if (containerInfo.cpuIntervals > 0) {
      log([container.name, hostname, 'cpu', 'restored', 'threshold'], `CPU has dropped below critical threshold and is now at ${value}%`);
    }
    containerInfo.cpuIntervals = 0;
  } else {
    containerInfo.cpuIntervals ++;
    log([container.name, hostname, 'cpu', 'warning', 'threshold'], `CPU usage has been at ${value}% for ${containerInfo.cpuIntervals * options.interval} seconds`);
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
    if (containerInfo.memIntervals > 0) {
      log([container.name, hostname, 'memory', 'restored', 'threshold'], `Memory has dropped below critical threshold and is now at ${value}%`);
    }
    containerInfo.memIntervals = 0;
  } else {
    containerInfo.memIntervals ++;
    log([container.name, hostname, 'memory', 'warning', 'threshold'], `Memory usage has been at ${value}% for ${containerInfo.memIntervals * options.interval} seconds`);
  }
};

const updateStats = (container, stats, options) => {
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
  addValue(cpuPercent, containers[container.id].cpuScores);
  // update the previous cpu/mem values:
  containers[container.id].previousCPU = cpuStats.cpu_usage.total_usage;
  containers[container.id].previousSystem = cpuStats.system_cpu_usage;
};

const printStats = (container, stats, options) => {
  const cpuPercent = getAverage(containers[container.id].cpuScores);
  logContainerCpu(container, cpuPercent, options);
  // get memory usage stats:
  const memStats = stats.memory_stats;
  const memPercent = memStats.limit ? ((memStats.usage / memStats.limit) * 100.0).toFixed(2) : 0.00;
  logContainerMemory(container, memPercent, options);
};


// the main processing loop:
const runLog = async(docker, options) => {
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
          memIntervals: 0,
          cpuScores: {}
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
    runLog(docker, options);
  }
};

// queries the api at regular intervals:
const runMonitor = async(docker, options) => {
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
          memIntervals: 0,
          // maintain list of { timestamp: value };
          cpuScores: {},
        };
      }
      if (!stats) {
        return log(['docker-ops', 'warning'], `Failed to get stats for container ${container.name}`);
      }
      updateStats(container, stats, options);
    });
  } catch (e) {
    // if there was an error at any point, log it:
    log(e);
  } finally {
    // can start logging once we're ready:
    if (!started) {
      started = new Date().getTime();
      runLog(docker, options);
    }
    // wait for 2 seconds and then do it again:
    await wait(2);
    runMonitor(docker, options);
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
  log([hostname, 'docker-ops', 'info'], `Interval length: ${options.interval}, CPU threshold: ${options.cpuThreshold}% Memory threshold: ${options.memThreshold}%.`);
  // only need to create the dockerode object once:
  const docker = new Docker();
  runMonitor(docker, options);
};
