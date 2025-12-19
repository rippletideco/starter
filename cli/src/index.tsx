#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    backendUrl: 'https://rippletide-backend.azurewebsites.net',
    dashboardUrl: 'https://eval.rippletide.com'
  };

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--backend-url' || args[i] === '-b') && args[i + 1]) {
      options.backendUrl = args[i + 1];
      i++;
    } else if ((args[i] === '--dashboard-url' || args[i] === '-d') && args[i + 1]) {
      options.dashboardUrl = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Rippletide CLI

Usage:
  rippletide eval [options]

Options:
  -b, --backend-url <url>     Backend API URL (default: https://rippletide-backend.azurewebsites.net)
  -d, --dashboard-url <url>   Dashboard URL (default: https://eval.rippletide.com)
  -h, --help                  Show this help message

Examples:
  rippletide eval
  rippletide eval -b http://localhost:3001 -d http://localhost:5173
`);
      process.exit(0);
    }
  }

  return options;
};

const options = parseArgs();

process.stdout.write('\x1Bc');

render(<App backendUrl={options.backendUrl} dashboardUrl={options.dashboardUrl} />);
