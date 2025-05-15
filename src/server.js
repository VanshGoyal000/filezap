import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import getPort from 'get-port';
import ip from 'ip';
import ora from 'ora';
import os from 'os';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import ngrok from 'ngrok';
import axios from 'axios';
import boxen from 'boxen';
import gradient from 'gradient-string';
import crypto from 'crypto';
import readline from 'readline';
import { logDebug, initDebugLogging } from '../utils/logger.js';
import { tunnelManager } from '../utils/tunnelProviders.js';
import { exec } from 'child_process';

// Base configuration
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const DEBUG_LOG_PATH = path.join(os.homedir(), '.filezap', 'logs', 'debug.log');

// Function to generate a random password
function generateRandomPassword(length = 6) {
  return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

// Function to shorten URL using TinyURL API
async function shortenUrl(url) {
  try {
    const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    return response.data;
  } catch (error) {
    console.error('URL shortening failed. Using original URL.');
    return url;
  }
}

// Check for existing tunnels and close them
async function closeExistingTunnels() {
  try {
    logDebug('Closing any existing tunnels...');
    const result = await tunnelManager.closeAllTunnels();
    
    if (result.closed > 0) {
      logDebug(`Closed ${result.closed} tunnels`);
    }
    
    if (result.failed > 0) {
      logDebug(`Failed to close ${result.failed} tunnels`);
      logDebug('Errors:', result.errors);
    }
    
    return true;
  } catch (error) {
    logDebug(`Error during tunnel cleanup: ${error.message}`);
    return false;
  }
}

export async function startFileServer(filePath, options = {}) {
  // Initialize debug logging and tunnel manager
  const isDebug = options.debug === true;
  const webOnly = options.webOnly === true;
  const customHttpPort = options.httpPort || null;
  const openBrowser = options.openBrowser || false;
  
  initDebugLogging(isDebug);
  
  logDebug('Starting file server with options:', options);
  
  const spinner = ora('Starting file sharing server...').start();
  let ngrokUrl = null;
  let ngrokTunnel = null;
  let shortenedUrl = null;
  
  // Set up password protection (default to random password if not provided but protection enabled)
  const usePassword = options.passwordProtect === true;
  let password = usePassword ? (options.password || generateRandomPassword()) : null;
  
  // Create a function to clean up resources for better error handling
  let server = null;
  let wss = null;
  let serverTimeout = null;
  
  // Add enhanced path normalization
  try {
    // Normalize file path to handle different formats
    filePath = path.normalize(filePath);
    
    // Handle Windows paths that may have quotes or escape characters
    if ((filePath.startsWith('"') && filePath.endsWith('"')) || 
        (filePath.startsWith("'") && filePath.endsWith("'"))) {
      filePath = filePath.substring(1, filePath.length - 1);
    }
    
    // Handle duplicated paths like E:\path\"E:\path\file.txt"
    const match = filePath.match(/^([A-Z]:\\.*?)\\?"[A-Z]:\\/i);
    if (match && match[1]) {
      // The file path was duplicated, extract the part after the quotes
      const pathAfterQuotes = filePath.match(/"([A-Z]:\\.*?)"/i);
      if (pathAfterQuotes && pathAfterQuotes[1]) {
        filePath = pathAfterQuotes[1];
      }
    }
    
    logDebug(`Normalized file path: ${filePath}`);
  } catch (pathError) {
    logDebug(`Error normalizing path: ${pathError.message}`);
    // Continue with the original path
  }
  
  async function cleanupAndExit(code = 0) {
    logDebug('Cleaning up resources...');
    try {
      if (ngrokUrl) {
        spinner.text = 'Closing global tunnel...';
        spinner.start();
        try {
          await tunnelManager.closeTunnel(ngrokUrl);
          spinner.succeed('Global tunnel closed');
          logDebug('Tunnel closed successfully');
        } catch (e) {
          logDebug(`Error closing tunnel: ${e.message}`);
          spinner.fail(`Failed to close tunnel: ${e.message}`);
        }
      }
      
      if (wss) {
        logDebug('Closing WebSocket server');
        wss.close();
      }
      
      if (server) {
        logDebug('Closing HTTP server');
        server.close();
      }
      
      if (serverTimeout) {
        clearTimeout(serverTimeout);
      }
      
      console.log(chalk.green('File sharing ended.'));
      
      if (code !== 0 && isDebug) {
        console.log(chalk.yellow(`\nFor more details, check the debug log at: ${DEBUG_LOG_PATH}`));
      }
      
      logDebug('Cleanup complete, exiting');
      
      if (!isDebug || code === 0) {
        process.exit(code);
      } else {
        // In debug mode with errors, keep the console open
        console.log(chalk.yellow('\nPress Enter to exit...'));
        process.stdin.once('data', () => process.exit(code));
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
      process.exit(1);
    }
  }
  
  try {
    // Make sure any existing tunnels are closed
    logDebug('Checking for existing ngrok tunnels...');
    await closeExistingTunnels();
    
    // Check if file exists with improved error handling
    if (!fs.existsSync(filePath)) {
      spinner.fail(`File not found: ${filePath}`);
      logDebug(`File not found: ${filePath}`);
      
      // Try to provide more helpful error information
      console.log(chalk.yellow('\nThe file could not be found. This could be due to:'));
      console.log('1. The file path contains special characters that are not handled correctly');
      console.log('2. The application does not have permission to access this location');
      console.log('3. The file was moved or deleted since you selected it');
      console.log('\nTry the following:');
      console.log('1. Copy the file to a simple path (like your desktop)');
      console.log('2. Try drag-and-drop the file onto the command window and use "cpd send" command');
      console.log('3. Run the application as administrator if accessing protected locations');
      
      return await cleanupAndExit(1);
    }

    // Get file details
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    
    // Get an available port for WebSocket
    const wsPort = await getPort();
    // Get another port for HTTP server
    const httpPort = await getPort({port: wsPort + 1});
    
    // Get all network interfaces
    const networkInterfaces = os.networkInterfaces();
    const localIps = [];

    // Helper function to rank IP addresses by likelihood of being the main connection
    function rankIpAddress(ip) {
      // Deprioritize virtual adapters
      if (ip.startsWith('192.168.56.')) return 10;  // VirtualBox
      if (ip.startsWith('172.16.')) return 5;       // Docker/VM common
      if (ip.startsWith('10.')) return 3;           // Common subnet but sometimes internal
      
      // Prioritize common home/office networks
      if (ip.startsWith('192.168.1.') || 
          ip.startsWith('192.168.0.') || 
          ip.startsWith('192.168.2.') ||
          ip.startsWith('192.168.100.')) return 0;
          
      return 2; // Default priority
    }

    // Find all IPv4 addresses
    let foundIps = [];
    Object.keys(networkInterfaces).forEach(ifaceName => {
      networkInterfaces[ifaceName].forEach(iface => {
        if (iface.family === 'IPv4' && !iface.internal) {
          foundIps.push({
            address: iface.address,
            priority: rankIpAddress(iface.address)
          });
        }
      });
    });

    // Sort IPs by priority (lowest first)
    foundIps.sort((a, b) => a.priority - b.priority);

    // Add the sorted IPs to localIps
    foundIps.forEach(ip => localIps.push(ip.address));

    // Fallback to the ip package if no address found
    if (localIps.length === 0) {
      localIps.push(ip.address());
    }

    // Get the primary IP (first prioritized non-internal IPv4 address)
    const primaryIp = localIps[0];    
    // Create WebSocket server
    wss = new WebSocketServer({ port: wsPort });
    logDebug(`WebSocket server started on port ${wsPort}`);
    
    // Create HTTP server for web interface with password protection
    server = http.createServer((req, res) => {
      // Parse URL and query parameters
      const url = new URL(req.url, `http://${req.headers.host}`);
      const params = url.searchParams;
      const enteredPassword = params.get('password');
      const isAuthenticated = !usePassword || enteredPassword === password;
      
      if (url.pathname === '/') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        
        if (usePassword && !isAuthenticated) {
          // Show improved password form with better mobile support
          res.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>FileZap - Password Required</title>
              <style>
                * {
                  box-sizing: border-box;
                  margin: 0;
                  padding: 0;
                }
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                  background-color: #f8f9fa;
                  color: #212529;
                  line-height: 1.5;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 20px;
                }
                .card {
                  background: white;
                  border-radius: 12px;
                  box-shadow: 0 6px 18px rgba(0,0,0,0.1);
                  padding: 30px;
                  margin-top: 40px;
                  text-align: center;
                }
                .logo {
                  margin-bottom: 20px;
                }
                .logo svg {
                  width: 100px;
                  height: 100px;
                }
                h1 {
                  color: #3056D3;
                  font-size: 1.8rem;
                  margin-bottom: 20px;
                }
                .file-info {
                  background: #f5f5f5;
                  padding: 15px;
                  border-radius: 8px;
                  margin: 20px 0;
                  text-align: left;
                }
                .input-group {
                  margin: 25px 0;
                }
                input[type="password"] {
                  width: 100%;
                  padding: 14px;
                  border: 1px solid #ddd;
                  border-radius: 6px;
                  font-size: 16px;
                  transition: border-color 0.3s;
                }
                input[type="password"]:focus {
                  outline: none;
                  border-color: #3056D3;
                  box-shadow: 0 0 0 3px rgba(48, 86, 211, 0.25);
                }
                .button {
                  background: #3056D3;
                  color: white;
                  padding: 14px 30px;
                  border-radius: 6px;
                  text-decoration: none;
                  font-weight: 600;
                  border: none;
                  cursor: pointer;
                  font-size: 16px;
                  width: 100%;
                  transition: background-color 0.3s;
                }
                .button:hover {
                  background: #2045c0;
                }
                .footer {
                  margin-top: 30px;
                  font-size: 0.8em;
                  color: #6c757d;
                }
                @media (max-width: 480px) {
                  .card {
                    padding: 20px;
                    margin-top: 20px;
                  }
                  h1 {
                    font-size: 1.5rem;
                  }
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="card">
                  <div class="logo">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M19 9L14 4L4 4L4 20L20 20L20 9L19 9Z" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M14 4V9H19" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M12 12V16" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M10 14H14" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                  <h1>Password Protected File</h1>
                  <div class="file-info">
                    <h3>${fileName}</h3>
                    <p>Size: ${(fileSize / 1024).toFixed(2)} KB</p>
                  </div>
                  <p>This file is password protected. Please enter the password to continue.</p>
                  <form method="get" action="/">
                    <div class="input-group">
                      <input type="password" name="password" placeholder="Enter password" required>
                    </div>
                    <button type="submit" class="button">Unlock File</button>
                  </form>
                  <div class="footer">
                    Powered by FileZap - Secure File Sharing
                  </div>
                </div>
              </div>
            </body>
            </html>
          `);
        } else {
          // Show improved download page with better mobile support
          res.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>FileZap - Download ${fileName}</title>
              <style>
                * {
                  box-sizing: border-box;
                  margin: 0;
                  padding: 0;
                }
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                  background-color: #f8f9fa;
                  color: #212529;
                  line-height: 1.5;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 20px;
                }
                .card {
                  background: white;
                  border-radius: 12px;
                  box-shadow: 0 6px 18px rgba(0,0,0,0.1);
                  padding: 30px;
                  margin-top: 40px;
                }
                .header {
                  display: flex;
                  align-items: center;
                  margin-bottom: 20px;
                }
                .logo {
                  margin-right: 15px;
                }
                .logo svg {
                  width: 40px;
                  height: 40px;
                }
                h1 {
                  color: #3056D3;
                  font-size: 1.8rem;
                  flex-grow: 1;
                }
                .file-info {
                  background: #f5f5f5;
                  padding: 20px;
                  border-radius: 8px;
                  margin: 20px 0;
                }
                .file-name {
                  font-size: 1.2rem;
                  font-weight: 600;
                  color: #343a40;
                  word-break: break-all;
                }
                .file-size {
                  color: #6c757d;
                  margin-top: 5px;
                }
                .share-link {
                  background: #13c296;
                  color: white;
                  padding: 15px 20px;
                  border-radius: 8px;
                  margin: 25px 0;
                  word-break: break-all;
                }
                .button {
                  display: inline-block;
                  background: #3056D3;
                  color: white;
                  padding: 14px 30px;
                  border-radius: 6px;
                  text-decoration: none;
                  font-weight: 600;
                  width: 100%;
                  text-align: center;
                  transition: background-color 0.3s;
                }
                .button:hover {
                  background: #2045c0;
                }
                .options {
                  margin: 20px 0;
                }
                .command {
                  background: #343a40;
                  color: #f8f9fa;
                  padding: 15px;
                  border-radius: 6px;
                  font-family: monospace;
                  overflow-x: auto;
                  white-space: nowrap;
                  margin: 10px 0 20px 0;
                }
                .badge {
                  display: inline-block;
                  background: #ffc107;
                  color: #212529;
                  padding: 4px 8px;
                  border-radius: 30px;
                  font-size: 12px;
                  font-weight: 600;
                  margin-left: 10px;
                  vertical-align: middle;
                }
                .footer {
                  text-align: center;
                  margin-top: 30px;
                  font-size: 0.8em;
                  color: #6c757d;
                }
                @media (max-width: 480px) {
                  .card {
                    padding: 20px;
                    margin-top: 20px;
                  }
                  h1 {
                    font-size: 1.5rem;
                  }
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="card">
                  <div class="header">
                    <div class="logo">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 9L14 4L4 4L4 20L20 20L20 9L19 9Z" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M14 4V9H19" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M7 13L10 16L17 9" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                    <h1>FileZap Transfer${usePassword ? ' <span class="badge">SECURED</span>' : ''}</h1>
                  </div>

                  <div class="file-info">
                    <div class="file-name">${fileName}</div>
                    <div class="file-size">Size: ${(fileSize / 1024).toFixed(2)} KB</div>
                  </div>

                  ${shortenedUrl ? `
                    <div class="share-link">
                      <strong>Share this link:</strong><br>
                      ${shortenedUrl}${usePassword ? `<br><strong>Password:</strong> ${password}` : ''}
                    </div>
                  ` : ''}

                  <p>Choose your download method:</p>
                  <a href="/download${usePassword ? `?password=${password}` : ''}" class="button">Download File</a>
                  
                  <div class="options">
                    <p>Or using the command line:</p>
                    <div class="command">filezap receive ${primaryIp} ${wsPort} "${fileName}"${usePassword ? ` --password "${password}"` : ''}</div>
                  </div>

                  <div class="footer">
                    Powered by FileZap - Fast & Secure File Sharing
                  </div>
                </div>
              </div>
            </body>
            </html>
          `);
        }
        res.end();
      } else if (url.pathname === '/status') {
        // New status page for context menu sharing and Alt+S shortcut
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FileZap - Sharing ${fileName}</title>
            <style>
              * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
              }
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background-color: #f8f9fa;
                color: #212529;
                line-height: 1.5;
              }
              .container {
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
              }
              header {
                display: flex;
                align-items: center;
                margin-bottom: 40px;
              }
              .logo {
                width: 50px;
                height: 50px;
                margin-right: 15px;
              }
              .app-title {
                font-size: 1.8rem;
                color: #3056D3;
              }
              .main-card {
                background: white;
                border-radius: 12px;
                box-shadow: 0 6px 18px rgba(0,0,0,0.1);
                padding: 30px;
                margin-bottom: 30px;
              }
              .status {
                display: flex;
                align-items: center;
                margin-bottom: 20px;
              }
              .status-icon {
                width: 24px;
                height: 24px;
                background-color: #13c296;
                border-radius: 50%;
                margin-right: 10px;
                position: relative;
              }
              .status-icon:after {
                content: '';
                position: absolute;
                top: 7px;
                left: 7px;
                width: 10px;
                height: 10px;
                background-color: white;
                border-radius: 50%;
              }
              .status-text {
                font-size: 1.2rem;
                font-weight: 600;
              }
              .file-info {
                background: #f5f5f5;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
              }
              .file-name {
                font-size: 1.2rem;
                font-weight: 600;
                color: #343a40;
                word-break: break-all;
              }
              .file-size {
                color: #6c757d;
                margin-top: 5px;
              }
              .sharing-section {
                background: white;
                border-radius: 12px;
                box-shadow: 0 6px 18px rgba(0,0,0,0.1);
                padding: 30px;
                margin-bottom: 30px;
              }
              .section-title {
                font-size: 1.4rem;
                margin-bottom: 20px;
                color: #3056D3;
                display: flex;
                align-items: center;
              }
              .section-title svg {
                width: 24px;
                height: 24px;
                margin-right: 10px;
              }
              .share-link {
                background: #13c296;
                color: white;
                padding: 15px 20px;
                border-radius: 8px;
                margin: 15px 0;
                word-break: break-all;
              }
              .info-row {
                display: flex;
                flex-wrap: wrap;
                gap: 20px;
                margin-bottom: 20px;
              }
              .info-box {
                flex: 1;
                min-width: 200px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 8px;
                border-left: 4px solid #3056D3;
              }
              .info-box p {
                margin-top: 5px;
                color: #6c757d;
              }
              .qr-container {
                text-align: center;
                margin: 20px 0;
              }
              .qr-code {
                background: white;
                display: inline-block;
                padding: 15px;
                border-radius: 8px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
              }
              .button {
                display: inline-block;
                background: #3056D3;
                color: white;
                padding: 12px 25px;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 600;
                text-align: center;
                transition: background-color 0.3s;
              }
              .button:hover {
                background: #2045c0;
              }
              .button.secondary {
                background: #6c757d;
              }
              .button.secondary:hover {
                background: #5a6268;
              }
              .flex-space {
                display: flex;
                justify-content: space-between;
                gap: 15px;
              }
              .copy-btn {
                background: #6c757d;
                color: white;
                border: none;
                border-radius: 6px;
                padding: 8px 15px;
                cursor: pointer;
                font-size: 0.9rem;
              }
              .command {
                background: #343a40;
                color: #f8f9fa;
                padding: 15px;
                border-radius: 6px;
                font-family: monospace;
                overflow-x: auto;
                white-space: nowrap;
                margin: 10px 0;
              }
              .footer {
                text-align: center;
                margin-top: 30px;
                color: #6c757d;
                font-size: 0.9rem;
              }
              @media (max-width: 768px) {
                .info-box {
                  min-width: 100%;
                }
                .flex-space {
                  flex-direction: column;
                }
                .button {
                  width: 100%;
                }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <header>
                <svg class="logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 9L14 4L4 4L4 20L20 20L20 9L19 9Z" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M14 4V9H19" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M7 13L10 16L17 9" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <h1 class="app-title">FileZap</h1>
              </header>
              
              <div class="main-card">
                <div class="status">
                  <div class="status-icon"></div>
                  <div class="status-text">File is being shared</div>
                </div>
                
                <div class="file-info">
                  <div class="file-name">${fileName}</div>
                  <div class="file-size">Size: ${(fileSize / 1024).toFixed(2)} KB</div>
                </div>
                
                ${usePassword ? `
                <div class="info-box">
                  <strong>Password Protection:</strong>
                  <p>This file is protected with password: <strong>${password}</strong></p>
                </div>
                ` : ''}
              </div>

              ${ngrokUrl ? `
              <div class="sharing-section">
                <h2 class="section-title">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M3 12H21" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M12 3C14.5013 5.73835 15.9228 9.29203 16 13C15.9228 16.708 14.5013 20.2616 12 23C9.49872 20.2616 8.07725 16.708 8 13C8.07725 9.29203 9.49872 5.73835 12 3Z" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  Share Globally
                </h2>
                
                <div class="share-link">
                  <div class="flex-space">
                    <span><strong>Share Link:</strong> ${shortenedUrl || ngrokUrl}</span>
                    <button class="copy-btn" onclick="navigator.clipboard.writeText('${shortenedUrl || ngrokUrl}')">Copy</button>
                  </div>
                </div>
                
                <div class="qr-container">
                  <div class="qr-code">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shortenedUrl || ngrokUrl)}" 
                         alt="QR Code" width="200" height="200">
                  </div>
                  <p>Scan to download</p>
                </div>
                
                <div class="info-row">
                  <div class="info-box">
                    <strong>Command Line:</strong>
                    <div class="command">filezap get "${shortenedUrl || ngrokUrl}" "${fileName}"${usePassword ? ` --password "${password}"` : ''}</div>
                  </div>
                </div>
                
                <div class="flex-space">
                  <a href="${shortenedUrl || ngrokUrl}" target="_blank" class="button">Open In Browser</a>
                </div>
              </div>
              ` : ''}
              
              <div class="sharing-section">
                <h2 class="section-title">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 4L12 12L4 4" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M4 4H20V18C20 18.5304 19.7893 19.0391 19.4142 19.4142C19.0391 19.7893 18.5304 20 18 20H6C5.46957 20 4.96086 19.7893 4.58579 19.4142C4.21071 19.0391 4 18.5304 4 18V4Z" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M4 14H12V20" stroke="#3056D3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  Local Network Sharing
                </h2>
                
                <div class="info-row">
                  <div class="info-box">
                    <strong>Local Network Link:</strong>
                    <p>http://${primaryIp}:${httpPort}</p>
                    <button class="copy-btn" style="margin-top:5px" onclick="navigator.clipboard.writeText('http://${primaryIp}:${httpPort}')">Copy</button>
                  </div>
                  
                  <div class="info-box">
                    <strong>Command Line:</strong>
                    <p>filezap receive ${primaryIp} ${wsPort} "${fileName}"${usePassword ? ` --password "${password}"` : ''}</p>
                  </div>
                </div>
                
                <div class="qr-container">
                  <div class="qr-code">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`http://${primaryIp}:${httpPort}${usePassword ? `?password=${password}` : ''}`)}" 
                         alt="QR Code" width="200" height="200">
                  </div>
                  <p>Scan to download</p>
                </div>
                
                <div class="flex-space">
                  <a href="http://${primaryIp}:${httpPort}${usePassword ? `?password=${password}` : ''}" target="_blank" class="button">Open In Browser</a>
                  <button onclick="navigator.clipboard.writeText('filezap receive ${primaryIp} ${wsPort} \\"${fileName}\\"${usePassword ? ` --password \\"${password}\\"` : ''}'); alert('Command copied!');" class="button secondary">Copy Command</button>
                </div>
              </div>
              
              <div class="footer">
                <p>FileZap - Fast & Secure File Sharing</p>
                <p>File will be available for 30 minutes or until window is closed</p>
              </div>
            </div>
            
            <script>
              // Auto-refresh status every 30 seconds
              setInterval(() => {
                fetch('/ping')
                  .catch(() => {
                    // If server is down, notify user
                    document.body.innerHTML = '<div style="text-align:center;padding:50px;"><h1>Sharing has ended</h1><p>The file is no longer being shared.</p></div>';
                  });
              }, 30000);
            </script>
          </body>
          </html>
        `);
        res.end();
      } else if (url.pathname === '/ping') {
        // Simple endpoint to check if server is still running
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({status: 'ok'}));
      } else if (url.pathname === '/download') {
        // Check password for download
        if (usePassword && !isAuthenticated) {
          res.writeHead(403, {'Content-Type': 'text/html'});
          res.write(`
            <html><body>
              <h1>Access Denied</h1>
              <p>Invalid password. Please go back and enter the correct password.</p>
              <p><a href="/">Go back</a></p>
            </body></html>
          `);
          res.end();
        } else {
          res.writeHead(200, {
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileSize
          });
          const fileStream = fs.createReadStream(filePath);
          fileStream.pipe(res);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    server.listen(httpPort);
    logDebug(`HTTP server started on port ${httpPort}`);
    
    // Start tunnel with a timeout and better error handling
    spinner.text = 'Creating secure tunnel with Serveo...';
    try {
      logDebug('Starting Serveo tunnel...');
      
      // Create the tunnel with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Tunnel creation timed out after 30 seconds')), 30000);
      });
      
      const tunnelPromise = tunnelManager.createTunnel(httpPort);
      const tunnelResult = await Promise.race([tunnelPromise, timeoutPromise]);
      
      if (tunnelResult && tunnelResult.success && tunnelResult.url) {
        ngrokUrl = tunnelResult.url;
        ngrokTunnel = tunnelResult;
        logDebug(`Serveo tunnel established: ${ngrokUrl}`);
        
        // Use the shortened URL if available, otherwise use the original URL
        shortenedUrl = tunnelResult.shortenedUrl || tunnelResult.url;
        logDebug(`URL to share: ${shortenedUrl}`);
        
        spinner.succeed(`Global file sharing ready! (via Serveo)`);
      } else {
        throw new Error(tunnelResult?.error || 'Failed to create tunnel');
      }
    } catch (tunnelError) {
      logDebug(`Tunnel connection error: ${tunnelError.message}`);
      console.log(chalk.yellow(`\n⚠️ Couldn't establish global tunnel: ${tunnelError.message}`));
      console.log(chalk.gray('Falling back to local network sharing only'));
      
      if (options.forceTunnel) {
        console.log(chalk.red(`\nForced tunnel mode was enabled but tunnel creation failed.`));
        console.log(chalk.red(`Check your internet connection and SSH setup.`));
      }
    }
    
    // Skip terminal output in web-only mode
    if (webOnly) {
      // Skip the terminal UI display
      logDebug('Running in web-only mode, skipping terminal UI');
    } else {
      // Show all possible connection addresses with beautified output
      console.log('\n' + chalk.bgGreen.black(' READY TO SHARE '));
      console.log(chalk.cyan('\n📁 FILE INFORMATION:'));
      console.log(`Name: ${fileName}`);
      console.log(`Size: ${(fileSize / 1024).toFixed(2)} KB`);
      
      // If password is enabled, show it prominently
      if (usePassword) {
        console.log(chalk.magenta('\n🔐 PASSWORD PROTECTION:'));
        console.log(`Password: ${chalk.bold.yellow(password)}`);
        console.log(chalk.gray('Recipients will need this password to download the file.'));
      }
      
      // If a tunnel is available, create a beautiful box with sharing info
      if (ngrokUrl) {
        const tunnelInfo = ngrokTunnel?.provider ? ` via ${ngrokTunnel.provider}` : '';
        const shareMessage = `
  🌍 SHARE GLOBALLY${tunnelInfo}
  
  ${gradient.rainbow('Easy Share Link:')}
  ${chalk.bold.green(shortenedUrl || ngrokUrl)}
  ${usePassword ? `\n  ${gradient.passion('Password: ' + password)}` : ''}
  
  ${gradient.pastel('Scan QR code to download:')}`;
        
        console.log(boxen(shareMessage, {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: 'cyan',
          backgroundColor: '#222'
        }));
        
        // Create a QR code for the shortened URL or ngrok URL
        qrcode.generate(shortenedUrl || ngrokUrl, {small: true});
        
        // Show command for the shortened URL
        if (shortenedUrl) {
          console.log(chalk.yellow('\n◉ Command line shortcut:'));
          console.log(`filezap get "${shortenedUrl}" "${fileName}"${usePassword ? ` --password "${password}"` : ''}`);
        }
      }
      
      // Display local network options in a nice box
      const localShareMessage = `
  🏠 LOCAL NETWORK SHARING
  
  ${gradient.fruit('Local Network Link:')}
  ${chalk.bold.blue(`http://${primaryIp}:${httpPort}`)}
  ${usePassword ? `\n  ${gradient.fruit('Password: ' + password)}` : ''}
  
  ${gradient.cristal('Command Line:')}
  ${chalk.bold.yellow(`filezap receive ${primaryIp} ${wsPort} ${fileName}${usePassword ? ` --password "${password}"` : ''}`)}`;
      
      console.log(boxen(localShareMessage, {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'blue',
        backgroundColor: '#222'
      }));
      
      // Create a QR code for the primary IP
      qrcode.generate(`http://${primaryIp}:${httpPort}${usePassword ? `?password=${password}` : ''}`, {small: true});
      
      // If multiple IPs detected, show alternatives in a compact way
      if (localIps.length > 1) {
        console.log(chalk.yellow('\n📡 ALTERNATIVE IP ADDRESSES:'));
        for (let i = 1; i < localIps.length; i++) {
          console.log(`${i+1}. ${chalk.cyan(`http://${localIps[i]}:${httpPort}`)}`);
        }
      }
      
      console.log(gradient.rainbow('\n✨ Server running and ready to accept connections ✨'));
      console.log(chalk.gray('Press Ctrl+C to stop sharing'));
    }
    
    // If browser opening is requested, do it for all modes
    if (openBrowser) {
      try {
        const statusUrl = `http://localhost:${httpPort}/status`;
        logDebug(`Opening browser to ${statusUrl}`);
        
        // Define a function to try multiple browser opening methods
        const tryOpenBrowser = async () => {
          return new Promise((resolve) => {
            let success = false;
            
            if (process.platform === 'win32') {
              // Method 1: Use start command (most reliable on Windows)
              exec(`cmd.exe /c start "" "${statusUrl}"`, (error) => {
                if (!error) {
                  success = true;
                  resolve(true);
                } else {
                  logDebug(`Failed to open with start command: ${error.message}`);
                  
                  // Method 2: Try PowerShell if cmd fails
                  exec(`powershell.exe -Command "Start-Process '${statusUrl}'"`, (psError) => {
                    if (!psError) {
                      success = true;
                      resolve(true);
                    } else {
                      logDebug(`Failed to open with PowerShell: ${psError.message}`);
                      
                      // Method 3: Try explorer.exe as a last resort
                      exec(`explorer.exe "${statusUrl}"`, (explorerError) => {
                        success = !explorerError;
                        resolve(!explorerError);
                        if (explorerError) {
                          logDebug(`Failed to open with explorer: ${explorerError.message}`);
                        }
                      });
                    }
                  });
                }
              });
            } else if (process.platform === 'darwin') {
              // macOS methods
              exec(`open "${statusUrl}"`, (error) => {
                if (!error) {
                  success = true;
                  resolve(true);
                } else {
                  logDebug(`Failed to open with 'open' command: ${error.message}`);
                  resolve(false);
                }
              });
            } else {
              // Linux methods - try multiple commands with fallbacks
              exec(`xdg-open "${statusUrl}"`, (error) => {
                if (!error) {
                  success = true;
                  resolve(true);
                } else {
                  logDebug(`Failed to open with xdg-open: ${error.message}`);
                  
                  // Try other browsers
                  const browsers = ['sensible-browser', 'x-www-browser', 'gnome-open', 'firefox', 'google-chrome', 'chromium-browser'];
                  let attemptCount = 0;
                  
                  const tryNextBrowser = (index) => {
                    if (index >= browsers.length) {
                      resolve(false);
                      return;
                    }
                    
                    exec(`${browsers[index]} "${statusUrl}"`, (browserError) => {
                      if (!browserError) {
                        success = true;
                        resolve(true);
                      } else {
                        logDebug(`Failed to open with ${browsers[index]}: ${browserError.message}`);
                        tryNextBrowser(index + 1);
                      }
                    });
                  };
                  
                  tryNextBrowser(0);
                }
              });
            }
            
            // Safety timeout
            setTimeout(() => {
              if (!success) {
                resolve(false);
              }
            }, 5000);
          });
        };
        
        // Try to open the browser
        tryOpenBrowser().then((opened) => {
          if (opened) {
            if (!webOnly) {
              console.log(chalk.green(`\n🌐 Browser window opened with sharing details`));
            }
          } else {
            console.log(chalk.yellow('\n⚠️ Failed to open browser window automatically.'));
            console.log(chalk.yellow(`Please open ${chalk.bold(`http://localhost:${httpPort}/status`)} in your browser.`));
            
            // Provide specific instructions based on platform
            if (process.platform === 'win32') {
              console.log(chalk.cyan('\nTip: Copy the URL above, then press Win+R and paste it.'));
            } else if (process.platform === 'darwin') {
              console.log(chalk.cyan('\nTip: Copy the URL above, then press Cmd+Space, type "Safari" and paste the URL.'));
            } else {
              console.log(chalk.cyan('\nTip: Copy the URL above and paste it in your browser\'s address bar.'));
            }
          }
        }).catch(() => {
          console.log(chalk.yellow('\n⚠️ Failed to open browser window automatically.'));
          console.log(chalk.yellow(`Please open ${chalk.bold(`http://localhost:${httpPort}/status`)} in your browser.`));
        });
      } catch (e) {
        logDebug(`Exception in browser opening logic: ${e.message}`);
        console.log(chalk.yellow('\n⚠️ Failed to open browser window automatically.'));
        console.log(chalk.yellow(`Please open ${chalk.bold(`http://localhost:${httpPort}/status`)} in your browser.`));
      }
    }
    
    // Add a timeout to close the server if no connections happen
    serverTimeout = setTimeout(async () => {
      logDebug('Sharing timeout reached. Closing server...');
      console.log(chalk.yellow('\nInactivity timeout reached. Closing server...'));
      await cleanupAndExit();
    }, 30 * 60 * 1000); // 30 minutes timeout
    
    // Set up cleanup on process exit
    process.on('SIGINT', async () => {
      logDebug('SIGINT received, stopping file sharing...');
      console.log('\nStopping file sharing...');
      clearTimeout(serverTimeout);
      await cleanupAndExit();
    });
    
    // Handle server errors
    server.on('error', (error) => {
      logDebug(`HTTP server error: ${error.message}`);
      spinner.fail(`Server error: ${error.message}`);
      cleanupAndExit(1);
    });
    
    // Handle WebSocket connections
    wss.on('connection', (ws) => {
      spinner.text = 'Client connected. Preparing to send file...';
      spinner.start();
      
      let clientName = "Unknown client";
      let transferComplete = false;
      
      logDebug('New client connected');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          // Check password if needed
          if (usePassword && data.type === 'ready') {
            if (data.password !== password) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid password'
              }));
              setTimeout(() => ws.close(), 1000);
              return;
            }
          }
          
          // Handle client ready message
          if (data.type === 'ready') {
            clientName = data.clientName || "Unknown client";
            spinner.text = `Sending file to ${clientName}`;
            
            // Send file metadata
            ws.send(JSON.stringify({
              type: 'metadata',
              fileName,
              fileSize
            }));
            
            // Send file data after a short delay
            setTimeout(() => {
              const fileContent = fs.readFileSync(filePath);
              ws.send(fileContent);
            }, 500);
          }
          
          // Handle successful receipt
          if (data.type === 'received') {
            transferComplete = true;
            spinner.succeed(`File sent successfully to ${data.clientName || clientName}!`);
            console.log(chalk.green('\n✓ Transfer complete!'));
            
            // Ask if user wants to continue sharing or exit
            console.log(chalk.yellow('\nPress Ctrl+C to stop sharing or wait for more connections.'));
            console.log(chalk.gray('Server will automatically close after 30 minutes of inactivity.'));
            
            // Reset the server timeout after successful transfer
            clearTimeout(serverTimeout);
            serverTimeout = setTimeout(async () => {
              console.log(chalk.yellow('\nInactivity timeout reached. Closing server...'));
              await cleanupAndExit();
            }, 30 * 60 * 1000); // 30 minutes timeout
            
            spinner.text = 'Waiting for more connections...';
            spinner.start();
          }
          
          // Handle pong (keep-alive response)
          if (data.type === 'pong') {
            // Connection is still alive
          }
        } catch (e) {
          // Invalid JSON, ignore
        }
      });
      
      ws.on('error', (error) => {
        logDebug(`WebSocket error: ${error.message}`);
        spinner.fail(`Connection error: ${error.message}`);
        // Keep server running for other connections
        spinner.text = 'Waiting for connections...';
        spinner.start();
      });
      
      ws.on('close', () => {
        // Connection closed, wait for more
        spinner.text = 'Waiting for connections...';
        spinner.start();
      });
      
      // Send keep-alive pings every 30 seconds
      const keepAliveInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          clearInterval(keepAliveInterval);
        }
      }, 30000);
    });
    
    wss.on('error', (error) => {
      logDebug(`WebSocket server error: ${error.message}`);
      spinner.fail(`Server error: ${error.message}`);
      cleanupAndExit(1);
    });
    
  } catch (error) {
    logDebug(`Fatal error: ${error.message}`);
    spinner.fail(`Failed to start file server: ${error.message}`);
    // Clean up ngrok if there was an error
    if (ngrokUrl) {
      try {
        await tunnelManager.closeTunnel(ngrokUrl);
      } catch (e) {
        logDebug(`Failed to close tunnel: ${e.message}`);
      }
    }
    
    if (isDebug) {
      console.log(chalk.red('\nError details:'));
      console.error(error);
      console.log(chalk.yellow(`\nFor more information, check the debug log at: ${DEBUG_LOG_PATH}`));
      console.log(chalk.yellow('\nPress Enter to exit...'));
      process.stdin.once('data', () => process.exit(1));
    } else {
      process.exit(1);
    }
  }
}