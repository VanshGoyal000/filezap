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

// Base configuration
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

export async function startFileServer(filePath) {
  const spinner = ora('Starting file sharing server...').start();
  
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      spinner.fail(`File not found: ${filePath}`);
      return;
    }

    // Get file details
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    
    // Get an available port for WebSocket
    const wsPort = await getPort();
    // Get another port for HTTP server
    const httpPort = await getPort({port: wsPort + 1});
    
    // Get all network interfaces
// When detecting network interfaces, prioritize common WiFi/Ethernet adapters
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
    const wss = new WebSocketServer({ port: wsPort });
    
    // Create HTTP server for web interface
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>CPD File Transfer</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                line-height: 1.6;
              }
              .container {
                background: #f5f5f5;
                border-radius: 10px;
                padding: 20px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 {
                color: #2c3e50;
              }
              .file-info {
                background: #fff;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
              }
              .button {
                display: inline-block;
                background: #3498db;
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                text-decoration: none;
                font-weight: bold;
              }
              .footer {
                margin-top: 30px;
                font-size: 0.8em;
                color: #7f8c8d;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>CPD File Transfer</h1>
              <div class="file-info">
                <h3>${fileName}</h3>
                <p>Size: ${(fileSize / 1024).toFixed(2)} KB</p>
              </div>
              <p>Choose your download method:</p>
              <p>
                <a href="/download" class="button">Download File</a>
              </p>
              <p>Or using the command line:</p>
              <pre>cpd receive ${primaryIp} ${wsPort} ${fileName}</pre>
              <div class="footer">
                Powered by CPD - Cross-Platform File Sharing
              </div>
            </div>
          </body>
          </html>
        `);
        res.end();
      } else if (req.url === '/download') {
        res.writeHead(200, {
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileSize
        });
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    server.listen(httpPort);
    
    spinner.succeed('File sharing ready!');
    
    // Show all possible connection addresses
    console.log('\n' + chalk.bgGreen.black(' READY TO SHARE '));
    console.log(chalk.cyan('\n📁 FILE INFORMATION:'));
    console.log(`Name: ${fileName}`);
    console.log(`Size: ${(fileSize / 1024).toFixed(2)} KB`);
    
    console.log(chalk.cyan('\n🌐 CONNECTION OPTIONS:'));
    
    // Create a QR code for the primary IP
    console.log(chalk.yellow('\n◉ OPTION 1: Scan QR code to download (fastest)'));
    qrcode.generate(`http://${primaryIp}:${httpPort}`, {small: true});
    
    console.log(chalk.yellow('\n◉ OPTION 2: Open in browser'));
    console.log(`http://${primaryIp}:${httpPort}`);
    
    console.log(chalk.yellow('\n◉ OPTION 3: Command line'));
    console.log(`cpd receive ${primaryIp} ${wsPort} ${fileName}`);
    
    // If multiple IPs detected, show alternatives
    if (localIps.length > 1) {
      console.log(chalk.yellow('\n📡 ALTERNATIVE IP ADDRESSES:'));
      for (let i = 1; i < localIps.length; i++) {
        console.log(`${i+1}. http://${localIps[i]}:${httpPort}`);
        console.log(`   Command: cpd receive ${localIps[i]} ${wsPort} ${fileName}`);
      }
    }
    
    console.log(chalk.green('\n✓ Server running and ready to accept connections'));
    console.log(chalk.gray('Press Ctrl+C to stop sharing'));
    
    // Handle client connections for WebSocket
    wss.on('connection', (ws) => {
      spinner.text = 'Client connected. Preparing to send file...';
      spinner.start();
      
      let clientName = "Unknown client";
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
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
            spinner.succeed(`File sent successfully to ${data.clientName || clientName}!`);
            console.log(chalk.green('\n✓ Transfer complete!'));
            
            // Keep server running for additional connections
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
      spinner.fail(`Server error: ${error.message}`);
      process.exit(1);
    });
    
    // Keep the process running
    process.stdin.resume();
    
  } catch (error) {
    spinner.fail(`Failed to start file server: ${error.message}`);
    process.exit(1);
  }
}