import {program} from 'commander';
import { generateKey } from '../commander/utils/generateKey.js';
import { copyCmd } from '../commander/utils/copyCmd.js';
import { listSharedFiles } from '../commander/utils/listSharedFiles.js';
import { startFileServer } from '../src/server.js';
import { receiveFile } from '../src/client.js';
import os from 'os';

program
  .version('1.0.0')
  .description('CPD - Cross-platform command-line file sharing tool');

program
  .command('key')
  .alias('-key')
  .description('Generate a new key')
  .action(() => {generateKey()});

program
  .command('copy <filepath> <userKey>')
  .description("Copy file to the user (key)")
  .action((filepath, userKey) => {
    copyCmd(filepath, userKey);
  });

program
  .command('list')
  .description("List all files shared with you")
  .action(() => {
    listSharedFiles();
  });

// New WebSocket commands
program
  .command('send <filepath>')
  .description("Start a file sharing server to send a file over network")
  .action((filepath) => {
    startFileServer(filepath);
  });

program
  .command('receive <serverIp> <serverPort> <fileName>')
  .description("Connect to a file sharing server and receive a file")
  .action((serverIp, serverPort, fileName) => {
    receiveFile(serverIp, serverPort, fileName);
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  // Show system info on empty command
  console.log(`CPD - File sharing tool`);
  console.log(`Running on: ${os.type()} (${os.platform()}) ${os.release()}`);
  console.log(`Hostname: ${os.hostname()}`);
  console.log(`Username: ${os.userInfo().username}`);
  console.log(`Network interfaces: ${Object.keys(os.networkInterfaces()).join(', ')}`);
  console.log(`\nType 'cpd --help' for available commands`);
}