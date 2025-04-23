# 📱 wa-bot (Baileys WhatsApp Bot)

Bot WhatsApp menggunakan [Baileys](https://github.com/WhiskeySockets/Baileys) dan Node.js untuk mengirim dan menerima pesan WhatsApp, serta mendukung autentikasi via QR code dan pairing code.

## 🚀 Fitur

- Autentikasi via QR Code / Pairing Code
- Kirim pesan ke nomor WhatsApp
- Terima dan tanggapi pesan masuk
- Terintegrasi dengan frontend via Socket.IO
- Siap diintegrasikan ke backend lain (REST API, Apps Script, dll.)

## 📦 Teknologi

- [Node.js](https://nodejs.org/)
- [Baileys](https://github.com/WhiskeySockets/Baileys)
- [Socket.IO](https://socket.io/)
- Express.js

## 🛠️ Instalasi

### **1. Clone repo ini**
   ```bash
   git clone https://github.com/lutfiangga/wa-bot-baileys.git
   ```
   ```bash
   cd wa-bot-baileys
   ```
### **2. Install depedencies**
   ```bash
   npm install
   ```
### **3. Jalankan server**
   ```bash
   node index.js
   ```
   atau
   ```bash
   npm start
   ```

## 📁 Struktur Folder

```
.
├── index.js           
├── index.html            
├── session_qr/                  
├── session_pairing/                 
├── package.json                   
└── package-lock.json
```
