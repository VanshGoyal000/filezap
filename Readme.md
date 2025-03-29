# filezap - Cross-Platform File Distribution Tool

![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)

filezap is a powerful command-line tool for seamless file sharing across different devices on the same network. Share files instantly between computers running Windows, macOS, or Linux without complex setup or third-party services.

## 🌟 Features
- 📋 **File Management** - List and organize shared files
- 🌐 **Real-time Network Sharing** - Transfer files over WebSockets
- 🔄 **Multiple Transfer Methods** - QR codes, browser interface, or CLI
- 📱 **Cross-Platform** - Works on Windows, macOS, and Linux
- 🔒 **No External Services** - Everything happens on your local network

## 📦 Installation

### Prerequisites
- **Node.js** 14.0.0 or higher
- **npm** 6.0.0 or higher

### Install from npm
```sh
npm install -g filezap
```

### Install from source
```sh
git clone https://github.com/vanshgoyal000/filezap.git
cd filezap
npm install
```

## 🚀 Usage

### List Files Shared with You
View all files that have been shared with your account:
```sh
filezap list
```

### Send a File Over Network
Start a file sharing server to send a file to another device on your network:
```sh
filezap send /path/to/file.txt
```
This will display:
- A **QR code** for quick mobile access
- A **URL** for browser download
- A **command-line instruction** for filezap users

### Receive a File
Connect to a file sharing server to receive a file:
```sh
filezap receive <ip> <port> <filename>
```
Example:
```sh
filezap receive 192.168.1.5 49152 presentation.pptx
```

## 📱 Mobile Device Support
filezap makes sharing with mobile devices simple:
1. On your computer, run:
   ```sh
   filezap send /path/to/file
   ```
2. On your mobile device:
   - **Option 1:** Scan the **QR code** with your camera app
   - **Option 2:** Open the **browser URL** displayed in the console
   - **Option 3:** Use alternative **IP addresses** if the primary one doesn't work

## 🔧 Troubleshooting

### Multiple Network Adapters
If you have multiple network adapters (VPN, virtual machines, etc.), filezap will prioritize common WiFi/Ethernet adapters and show alternatives.

### Connection Issues
If devices can't connect:
- Ensure both devices are on the **same network**
- Try **alternative IP addresses** shown in the console
- Check if **firewalls** are blocking the connection

### Firewall Configuration
On **Windows**, allow Node.js through your firewall or run:
```sh
New-NetFirewallRule -DisplayName "filezap File Sharing" -Direction Inbound -Protocol TCP -LocalPort 3000-65000 -Action Allow
```

## 💻 Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `filezap list` | List all files shared with you | `filezap list` |
| `filezap send <filepath>` | Share a file over the network | `filezap send ./presentation.pptx` |
| `filezap receive <ip> <port> <filename>` | Receive a shared file | `filezap receive 192.168.1.5 49152 presentation.pptx` |

## 📡 Alternative IP Addresses
If the primary IP doesn't work, try one of these:
```sh
http://192.168.153.208:54321
Command: filezap receive 192.168.153.208 54320 filename.ext
```

## 👥 Contributing
Contributions are welcome! Feel free to submit a Pull Request.

## 📜 License
This project is licensed under the **MIT License**.

---

🚀 Built with ❤️ By Vansh Goyal.
 filezap is perfect for classrooms, offices, or any environment where simple file sharing is needed.