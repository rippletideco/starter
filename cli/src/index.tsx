#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

process.stdout.write('\x1Bc');

render(<App />);
