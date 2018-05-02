#!/usr/bin/env node
const main = require('./index.js');

const argv = require('yargs')
  .options({
    slackReportRate: {
      alias: 'r',
      describe: 'only slack report threshold warnings at a rate of once per slackReportRate',
      default: 0
    },
    slackHook: {
      alias: 'l',
      describe: 'slack hook (will use the SLACK_HOOK environment variable if one is defined)',
    },
    emoji: {
      alias: 'e',
      describe: 'a slack emoji, be sure to enclose in colons (eg ":monkey_face:")',
      default: ':computer:'
    },
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
    memThreshold: {
      alias: 'm',
      describe: 'warn if % Memory Usage is above this level for too long ',
      default: 90,
      type: 'number'
    },
    verbose: {
      alias: 'v',
      describe: 'will log CPU stats at every interval regardless of whether it is above threshold',
      default: false,
      type: 'boolean'
    },
    exclude: {
      alias: 'e',
      describe: 'ignore containers that match this RegEx',
      default: false,
      type: 'string'
    }
  })
  .env()
  .argv;

main.start(argv);
