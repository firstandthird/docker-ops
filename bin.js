#!/usr/bin/env node
const main = require('./index.js');

const argv = require('yargs')
.options({
  interval: {
    alias: 'i',
    describe: 'number of seconds to wait between logging intervals',
    default: 10,
    type: 'number'
  },
  cpuThreshold: {
    alias: 'c',
    describe: 'warn if % CPU Usage is above this level for too long ',
    default: 90,
    type: 'number'
  },
  intervalsAllowed: {
    describe: 'number of logging intervals to allow before throwing a warning ',
    default: 1,
    type: 'number'
  },
  verbose: {
    alias: 'v',
    describe: 'will log CPU stats at every interval regardless of whether it is above threshold',
    default: false,
    type: 'boolean'
  }
}).argv;

console.log(`Interval length is ${argv.interval}, threshold is ${argv.cpuThreshold}% and containers can be above threshold for ${argv.intervalsAllowed} intervals`);
main.start(argv);
