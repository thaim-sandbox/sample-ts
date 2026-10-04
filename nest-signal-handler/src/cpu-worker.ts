import { parentPort, workerData } from 'node:worker_threads';
import { busyLoop } from './busy-loop.js';

parentPort!.postMessage(busyLoop(workerData as number));
