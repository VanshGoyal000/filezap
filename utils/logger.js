import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// Fix the inconsistent directory path (.filezap to .filezap)
const LOG_DIR = path.join(os.homedir(), '.filezap', 'logs');
const DEBUG_LOG_PATH = path.join(LOG_DIR, 'debug.log');
let isDebugMode = false;

/**
 * Initialize debug logging
 * @param {boolean} debugMode - Whether to enable debug mode
 */
export function initDebugLogging(debugMode) {
  isDebugMode = debugMode;
  
  if (isDebugMode) {
    // Create logs directory if it doesn't exist
    fs.ensureDirSync(LOG_DIR);
    
    // Add timestamp to log entries
    const now = new Date();
    const timestamp = `${now.toISOString()}\n${'='.repeat(50)}\n`;
    
    // Append to log file
    fs.appendFileSync(DEBUG_LOG_PATH, `\n\nSession started: ${timestamp}`);
  }
}

/**
 * Log debug information
 * @param {...any} args - Information to log
 */
export function logDebug(...args) {
  if (isDebugMode) {
    const timestamp = new Date().toISOString();
    const logMessage = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    // Write to log file
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${logMessage}\n`);
    
    // Also output to console with timestamp
    console.error(`[DEBUG] ${logMessage}`);
  }
}

/**
 * Get the path to the debug log file
 * @returns {string} Path to debug log file
 */
export function getDebugLogPath() {
  return DEBUG_LOG_PATH;
}
