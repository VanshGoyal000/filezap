#!/usr/bin/env node
import { execSync } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';
import os from 'os';

const spinner = ora('Setting up FileZap globally...').start();

try {
  // Run npm link to make filezap globally available
  spinner.text = 'Creating global symlink...';
  execSync('npm link', { stdio: 'pipe' });
  
  spinner.succeed('FileZap is now globally available!');
  
  console.log('\n' + chalk.green.bold('✓') + ' You can now run FileZap from anywhere using the ' + chalk.cyan('filezap') + ' command.');
  console.log('\nFor example:');
  console.log('  ' + chalk.yellow('filezap send myfile.txt'));
  console.log('  ' + chalk.yellow('filezap list'));
  
  // Suggest shell integration
  console.log('\nWould you like to install right-click menu integration?');
  console.log('Run: ' + chalk.cyan('filezap integrate'));
  
  // Show current system info
  console.log('\nSystem Information:');
  console.log('  OS: ' + os.type() + ' (' + os.platform() + ')');
  console.log('  Node: ' + process.version);
  
  // Show how to uninstall if needed
  console.log('\nTo uninstall FileZap from the global commands:');
  console.log('  ' + chalk.yellow('npm unlink -g filezap') + ' or ' + chalk.yellow('npm run unlink'));
  
} catch (error) {
  spinner.fail('Failed to set up FileZap globally');
  console.error('\n' + chalk.red('Error: ') + error.message);
  
  // Provide helpful error messages for common issues
  if (error.message.includes('permission')) {
    console.log('\nTry running with administrator/sudo privileges:');
    if (os.platform() === 'win32') {
      console.log('  ' + chalk.cyan('Right-click on Command Prompt/PowerShell and select "Run as administrator"'));
    } else {
      console.log('  ' + chalk.cyan('sudo npm link'));
    }
  }
  
  process.exit(1);
}
