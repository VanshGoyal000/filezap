import WebSocket, { WebSocketServer } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import getPort from 'get-port';
import ip from 'ip';
import ora from 'ora';
import os from 'os';

// Base configuration
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

export async function startFileServer(filePath) {
  const spinner = ora('Starting file sharing server...').start();
  
  try {
    // Get file details
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileContent = fs.readFileSync(filePath);
    
    // Get an available port
    const port = await getPort();
    const localIp = ip.address();
    
    // Create WebSocket server
    const wss = new WebSocketServer({ port });
    
    spinner.text = `Server running at ws://${localIp}:${port}`;
    spinner.info();
    
    console.log(`Share this command with the recipient:`);
    console.log(`cpd receive ${localIp} ${port} ${fileName}`);
    
    // Handle connections
    wss.on('connection', (ws) => {
      spinner.text = 'Client connected. Sending file...';
      spinner.start();
      
      // Send file metadata
      ws.send(JSON.stringify({
        type: 'metadata',
        fileName,
        fileSize
      }));
      
      // Send file data
      ws.send(fileContent);
      
      ws.on('message', (message) => {
        const data = JSON.parse(message.toString());
        if (data.type === 'received') {
          spinner.succeed('File sent successfully!');
          setTimeout(() => {
            wss.close();
            process.exit(0);
          }, 1000);
        }
      });
      
      ws.on('error', (error) => {
        spinner.fail(`Connection error: ${error.message}`);
        wss.close();
      });
    });
    
    wss.on('error', (error) => {
      spinner.fail(`Server error: ${error.message}`);
      process.exit(1);
    });
    
    // Keep the process running
    process.stdin.resume();
    console.log('Press Ctrl+C to cancel the file transfer');
    
  } catch (error) {
    spinner.fail(`Failed to start file server: ${error.message}`);
    process.exit(1);
  }
}