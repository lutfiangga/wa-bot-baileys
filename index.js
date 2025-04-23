const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs-extra");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;

// Separate session directories for different login methods
const QR_SESSION_DIR = path.join(__dirname, "session_qr");
const PAIRING_SESSION_DIR = path.join(__dirname, "session_pairing");

// Client instances
let qrClient = null;
let pairingClient = null;

app.use(express.static("public"));
app.use(express.json());

// QR Client initialization
async function startQRClient() {
  try {
    // Clean previous session if needed
    if (qrClient) {
      try {
        await qrClient.logout();
      } catch (err) {
        console.log(
          "QR client logout error (normal if first run):",
          err.message
        );
      }
      qrClient = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(QR_SESSION_DIR);

    qrClient = makeWASocket({
      auth: state,
      printQRInTerminal: true, // Enable terminal QR for debugging
      browser: ["Chrome", "Desktop", "120"],
      // browser: ["WhatsApp", "Desktop", "3.0"],
      connectTimeoutMs: 60000,
      qrTimeout: 40000,
    });

    qrClient.ev.on("creds.update", saveCreds);

    qrClient.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.log("QR code received, converting to image...");
        try {
          const qrImage = await qrcode.toDataURL(qr);
          io.emit("qr", qrImage);
          console.log("QR code sent to client");
        } catch (err) {
          console.error("QR code conversion error:", err.message);
          io.emit("error", "Failed to generate QR code");
        }
      }

      if (connection === "open") {
        console.log("✅ QR Client connected!");
        const me = qrClient.user;
        io.emit("authenticated", {
          name: me.name || "Tanpa Nama",
          number: me.id.split(":")[0],
          mode: "qr",
        });
      }

      if (connection === "close") {
        console.log("QR client connection closed");
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (statusCode !== DisconnectReason.loggedOut) {
          console.log("QR client reconnecting...");
          setTimeout(startQRClient, 2000);
        } else {
          console.log("QR client logged out");
          io.emit("disconnected", "QR session logged out");
        }
      }
    });

    return { status: true, message: "QR client started" };
  } catch (err) {
    console.error("Error starting QR client:", err);
    return { status: false, error: err.message };
  }
}

// Pairing Client initialization
async function startPairingClient(phoneNumber) {
  try {
    // Clean previous session
    if (pairingClient) {
      try {
        await pairingClient.logout();
      } catch (err) {
        console.log("Pairing client logout error:", err.message);
      }
      pairingClient = null;
    }

    // Ensure clean session directory
    // await fs.remove(PAIRING_SESSION_DIR);
    await fs.ensureDir(PAIRING_SESSION_DIR);
    console.log(
      "Session directory contents:",
      await fs.readdir(PAIRING_SESSION_DIR)
    );

    const { state, saveCreds } = await useMultiFileAuthState(
      PAIRING_SESSION_DIR
    );

    // Format number
    const formattedNumber = phoneNumber.replace(/^\+/, "");
    console.log("Formatted number for pairing:", formattedNumber);

    pairingClient = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["WhatsApp", "Desktop", "3.0"],
      connectTimeoutMs: 120000,
    });

    pairingClient.ev.on("creds.update", saveCreds);

    let codeRequested = false;
    let connectionReady = false;

    return new Promise((resolve, reject) => {
      const operationTimeout = setTimeout(() => {
        reject(new Error("Operation timeout after 120 seconds"));
      }, 120000);

      pairingClient.ev.on("connection.update", async (update) => {
        console.log(
          "Pairing connection update:",
          JSON.stringify(update, null, 2)
        );
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log("✅ Pairing Client connected!");
          connectionReady = true;
          const me = pairingClient.user;
          io.emit("authenticated", {
            name: me.name || "Tanpa Nama",
            number: me.id.split(":")[0],
            mode: "pairing",
          });
          clearTimeout(operationTimeout);
          resolve({ status: true, message: "Connected" });
          return;
        }

        if (connection === "connecting" && !codeRequested) {
          setTimeout(async () => {
            try {
              if (!codeRequested && pairingClient) {
                codeRequested = true;
                console.log("Requesting pairing code for:", formattedNumber);
                const code = await pairingClient.requestPairingCode(
                  formattedNumber
                );
                console.log("Pairing code received:", code);
                io.emit("pairing-code", code);
                // Keep connection alive for 60 seconds
                console.log("Keeping connection alive for pairing...");
                await new Promise((resolve) => setTimeout(resolve, 60000));
                if (!connectionReady) {
                  clearTimeout(operationTimeout);
                  resolve({ status: true, code });
                }
              }
            } catch (err) {
              console.error("Failed to get pairing code:", err);
              io.emit("error", "Failed to get pairing code: " + err.message);
              if (!connectionReady) {
                clearTimeout(operationTimeout);
                reject(err);
              }
            }
          }, 5000);
        }

        if (connection === "close") {
          console.log("Pairing client connection closed");
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorDetails = lastDisconnect?.error;
          console.log("Disconnect details:", {
            statusCode,
            error: errorDetails?.message,
            stack: errorDetails?.stack,
            data: errorDetails?.data,
          });

          if (statusCode === DisconnectReason.loggedOut) {
            console.log("Pairing client logged out");
            io.emit("disconnected", "Pairing session logged out");
          } else {
            console.log("Attempting to reconnect...");
            setTimeout(() => startPairingClient(phoneNumber), 5000);
          }

          if (!connectionReady && !codeRequested) {
            clearTimeout(operationTimeout);
            reject(new Error(`Connection closed with code ${statusCode}`));
          }
        }
      });
    });
  } catch (err) {
    console.error("Error starting pairing client:", err);
    return { status: false, error: err.message };
  }
}

// Update the endpoint to handle the improved function
app.post("/pairing-code", async (req, res) => {
  const { number } = req.body;

  // More lenient validation that accepts country codes with + or without
  if (!number || !/^(\+?\d+)$/.test(number)) {
    return res
      .status(400)
      .json({ status: false, error: "Invalid phone number format" });
  }

  try {
    // Start the process but don't wait for the entire connection to complete
    res.json({ status: true, message: "Pairing process started" });
    
    // Process in background to avoid timeout
    startPairingClient(number).catch((err) => {
      console.error("Background pairing process error:", err);
      io.emit("error", "Pairing process error: " + err.message);
    });
  } catch (err) {
    console.error("Pairing request error:", err);
    // Client already got a response, so we just log this error
  }
});

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/login/qr", async (req, res) => {
  const result = await startQRClient();
  res.json(result);
});

app.post("/send-message", async (req, res) => {
  const { number, message, mode = "qr" } = req.body;

  const client = mode === "pairing" ? pairingClient : qrClient;

  if (!client) {
    return res
      .status(400)
      .json({ status: false, error: `Client ${mode} belum login.` });
  }

  try {
    const waId = `${number.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
    await client.sendMessage(waId, { text: message });
    res.json({ status: true, message: "Message sent" });
  } catch (err) {
    res.status(500).json({ status: false, error: err.toString() });
  }
});

app.get("/logout/:mode", async (req, res) => {
  const { mode } = req.params;

  try {
    if (mode === "qr" && qrClient) {
      await qrClient.logout();
      // await fs.remove(QR_SESSION_DIR);
      qrClient = null;
      io.emit("disconnected", "QR session logged out");
    } else if (mode === "pairing" && pairingClient) {
      await pairingClient.logout();
      // await fs.remove(PAIRING_SESSION_DIR);
      pairingClient = null;
      io.emit("disconnected", "Pairing session logged out");
    } else {
      return res.status(400).json({
        status: false,
        error: "Invalid mode or client not initialized",
      });
    }

    res.json({ status: true, message: `${mode} client logged out` });
  } catch (err) {
    console.error(`Logout error (${mode}):`, err);
    res.status(500).json({ status: false, error: err.toString() });
  }
});

// Alternative pairing approach endpoint
app.post("/pairing-direct", async (req, res) => {
  const { number } = req.body;

  if (!number || !/^(\+?\d+)$/.test(number)) {
    return res
      .status(400)
      .json({ status: false, error: "Invalid phone number format" });
  }

  try {
    // Clean directory
    // await fs.remove(PAIRING_SESSION_DIR);
    await fs.ensureDir(PAIRING_SESSION_DIR);

    // Get auth state
    const { state, saveCreds } = await useMultiFileAuthState(
      PAIRING_SESSION_DIR
    );

    // Format number
    const formattedNumber = number.startsWith("+")
      ? number.substring(1)
      : number;

    // Create socket with specific options for pairing
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["Chrome", "Desktop", "120"],
      mobile: false, // Try setting mobile to false for pairing code
      connectTimeoutMs: 60000,
    });

    // Register creds update
    sock.ev.on("creds.update", saveCreds);

    // Directly try to request pairing code
    try {
      console.log("Directly requesting pairing code for:", formattedNumber);
      const code = await sock.requestPairingCode(formattedNumber);
      console.log("Direct pairing code received:", code);
      io.emit("pairing-code", code);

      // Set up connection listener for future events
      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log("✅ Direct pairing client connected!");
          const me = sock.user;
          io.emit("authenticated", {
            name: me.name || "Tanpa Nama",
            number: me.id.split(":")[0],
            mode: "pairing",
          });

          // Update global pairing client
          pairingClient = sock;
        }

        if (connection === "close") {
          console.log("Direct pairing client disconnected");
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          io.emit("disconnected", `Pairing disconnected (code: ${statusCode})`);
        }
      });

      return res.json({ status: true, message: "Pairing code generated" });
    } catch (err) {
      console.error("Direct pairing code error:", err);
      return res.status(500).json({ status: false, error: err.message });
    }
  } catch (err) {
    console.error("Direct method error:", err);
    return res.status(500).json({ status: false, error: err.message });
  }
});

// Status endpoints
app.get("/status", (req, res) => {
  res.json({
    qrClient: qrClient ? "connected" : "disconnected",
    pairingClient: pairingClient ? "connected" : "disconnected",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res
    .status(500)
    .json({ status: false, error: "Server error: " + err.message });
});

// Start server
server.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
