import ora from 'ora';
import os from 'os'
import fs from 'fs-extra'
import CryptoJS from 'crypto-js';
import path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.filezap');
const KEY_FILE = path.join(CONFIG_DIR, 'keys.json');  

fs.ensureDirSync(CONFIG_DIR);
if (!fs.existsSync(KEY_FILE)) {
  fs.writeJSONSync(KEY_FILE, {}, { spaces: 2 });
}

export function generateKey(){
    const spinner = ora("Generating secure Key").start();
    try {
        const newKey = CryptoJS.lib.WordArray.random(4).toString();
        const username = os.userInfo().username;
        
        const keys = fs.readJSONSync(KEY_FILE);
        
        keys[username] = newKey;
        fs.writeJSONSync(KEY_FILE, keys, { spaces: 2 });
        
        spinner.succeed(`Key generated successfully for ${username}`);
        console.log(`Your key: ${newKey}`);
        console.log(`Store this safely. Others will need it to copy files to you.`);
  
    } catch (error) {
        spinner.fail('failed to generate key');
        console.error(error);
        process.exit(1);
    }
}