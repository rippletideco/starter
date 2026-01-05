#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { ErrorHandler } from './errors/handler.js';
import { ValidationError } from './errors/types.js';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    backendUrl: 'https://rippletide-backend.azurewebsites.net',
    dashboardUrl: 'https://eval.rippletide.com',
    debug: false
  };

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--backend-url' || args[i] === '-b') && args[i + 1]) {
      options.backendUrl = args[i + 1];
      i++;
    } else if ((args[i] === '--dashboard-url' || args[i] === '-d') && args[i + 1]) {
      options.dashboardUrl = args[i + 1];
      i++;
    } else if (args[i] === '--debug') {
      options.debug = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Rippletide CLI

Usage:
  rippletide eval [options]

Options:
  -b, --backend-url <url>     Backend API URL (default: https://rippletide-backend.azurewebsites.net)
  -d, --dashboard-url <url>   Dashboard URL (default: https://eval.rippletide.com)
  --debug                      Show detailed error information and stack traces
  -h, --help                  Show this help message

Examples:
  rippletide eval
  rippletide eval -b http://localhost:3001 -d http://localhost:5173
  rippletide eval --debug
`);
      process.exit(0);
    } else if (!args[i].startsWith('-')) {
      throw new ValidationError(
        'command',
        args[i],
        `Unknown argument: ${args[i]}`
      );
    }
  }

  return options;
};

async function run() {
  try {
    const options = parseArgs();
    
    process.stdout.write('\x1Bc');
    
    const { waitUntilExit } = render(
      <App 
        backendUrl={options.backendUrl} 
        dashboardUrl={options.dashboardUrl} 
      />
    );
    
    await waitUntilExit();
  } catch (error) {
    ErrorHandler.handle(error);
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  ErrorHandler.handle(error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  ErrorHandler.handle(error);
  process.exit(1);
});

run();
