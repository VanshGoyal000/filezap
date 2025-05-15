import ngrok from 'ngrok';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { logDebug } from './logger.js';

// Directory to store tunnel info
const TUNNEL_DIR = path.join(os.homedir(), '.filezap', 'tunnels');
const TUNNEL_INFO_PATH = path.join(TUNNEL_DIR, 'active_tunnels.json');

/**
 * Initialize the tunnel manager
 */
export function initTunnelManager() {
  try {
    fs.ensureDirSync(TUNNEL_DIR);
    
    // Create tunnel file if it doesn't exist
    if (!fs.existsSync(TUNNEL_INFO_PATH)) {
      saveTunnelInfo([]);
    }
    
    // Validate the JSON format
    try {
      const data = fs.readJSONSync(TUNNEL_INFO_PATH);
      if (!data || !Array.isArray(data.tunnels)) {
        // Fix corrupted data
        saveTunnelInfo([]);
      }
    } catch (parseError) {
      logDebug(`Tunnel info file corrupted, recreating: ${parseError.message}`);
      saveTunnelInfo([]);
    }
  } catch (error) {
    logDebug(`Error initializing tunnel manager: ${error.message}`);
    // Try to proceed even with error
  }
}

/**
 * Save tunnel information to disk
 * @param {Array} tunnels - List of active tunnel URLs
 */
function saveTunnelInfo(tunnels) {
  try {
    fs.writeJSONSync(TUNNEL_INFO_PATH, {
      tunnels,
      lastUpdated: new Date().toISOString()
    }, { spaces: 2 });
  } catch (error) {
    logDebug(`Error saving tunnel info: ${error.message}`);
  }
}

/**
 * Load tunnel information from disk
 * @returns {Array} List of active tunnel URLs
 */
function loadTunnelInfo() {
  try {
    if (fs.existsSync(TUNNEL_INFO_PATH)) {
      const data = fs.readJSONSync(TUNNEL_INFO_PATH);
      return data.tunnels || [];
    }
  } catch (error) {
    logDebug(`Error loading tunnel info: ${error.message}`);
  }
  return [];
}

/**
 * Register a new tunnel
 * @param {string} tunnelUrl - The ngrok tunnel URL
 */
export function registerTunnel(tunnelUrl) {
  try {
    const tunnels = loadTunnelInfo();
    if (!tunnels.includes(tunnelUrl)) {
      tunnels.push(tunnelUrl);
      saveTunnelInfo(tunnels);
    }
  } catch (error) {
    logDebug(`Error registering tunnel: ${error.message}`);
  }
}

/**
 * Unregister a tunnel
 * @param {string} tunnelUrl - The ngrok tunnel URL
 */
export function unregisterTunnel(tunnelUrl) {
  try {
    const tunnels = loadTunnelInfo();
    const updatedTunnels = tunnels.filter(url => url !== tunnelUrl);
    saveTunnelInfo(updatedTunnels);
  } catch (error) {
    logDebug(`Error unregistering tunnel: ${error.message}`);
  }
}

/**
 * List all active tunnels
 * @returns {Promise<Object>} Object containing active tunnels info
 */
export async function listActiveTunnels() {
  const result = {
    fromNgrok: [],
    fromRegistry: loadTunnelInfo(),
    active: false,
    ngrokVersion: null,
    error: null
  };
  
  try {
    // Try to get ngrok version
    try {
      result.ngrokVersion = ngrok.getVersion ? await ngrok.getVersion() : 'unknown';
    } catch (versionError) {
      result.error = `Version error: ${versionError.message}`;
    }
    
    // Try to get running tunnels directly from ngrok
    try {
      await ngrok.connect({ addr: 9999, name: 'test-connection' });
      result.active = true;
      
      const tunnelList = await ngrok.listTunnels();
      if (tunnelList && tunnelList.tunnels) {
        result.fromNgrok = tunnelList.tunnels.map(t => t.public_url);
      }
      
      // Close the test tunnel
      await ngrok.disconnect('test-connection');
    } catch (tunnelError) {
      if (!result.error) {
        result.error = tunnelError.message;
      }
    }
    
    return result;
  } catch (error) {
    result.error = `General error: ${error.message}`;
    return result;
  }
}

/**
 * Close all tunnels
 * @returns {Promise<Object>} Results of the operation
 */
export async function closeAllTunnels() {
  const result = {
    closedFromNgrok: 0,
    closedFromRegistry: 0,
    errors: []
  };
  
  // Kill all ngrok processes
  try {
    await ngrok.kill();
    result.closedFromNgrok = 1;
  } catch (killError) {
    result.errors.push(`Kill error: ${killError.message}`);
  }
  
  // Clear the registry
  try {
    const registeredTunnels = loadTunnelInfo();
    result.closedFromRegistry = registeredTunnels.length;
    saveTunnelInfo([]);
  } catch (registryError) {
    result.errors.push(`Registry error: ${registryError.message}`);
  }
  
  return result;
}
