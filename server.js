// server.js
const dgram = require('dgram');
const WebSocket = require('ws');

// 1. WebSocket-Server auf Port 8080 starten
const wss = new WebSocket.Server({ port: 8080 });
console.log('WebSocket Server läuft auf ws://localhost:8080');

// 2. UDP Socket erstellen für F1 24 Telemetrie (Standard-Port: 20777)
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('listening', () => {
  const address = udpSocket.address();
  console.log(`UDP Telemetrie Receiver hört auf ${address.address}:${address.port}`);
});

udpSocket.on('message', (msg) => {
  // Hier empfangen wir die Telemetriedaten von SimHub oder F1 24
  // Beispielhafte Datenstruktur für Demonstration aufbereiten:
  const telemetryData = parseF1Telemetry(msg);

  // Sende Daten per WebSocket an alle verbundenen Browser-Clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(telemetryData));
    }
  });
});

// Hilfsfunktion zum Parsen der UDP-Pakete (Vereinfachtes Beispiel)
function parseF1Telemetry(buffer) {
  // Hier liest du die Structs der F1 UDP API aus.
  // Für F1 24 gibt es npm-Pakete wie 'f1-2021-udp' oder 'f1-telemetry-client'
  return {
    timestamp: Date.now(),
    driver: 'Timo',
    gap: '--',
    tyre: 'MED',
    sectorTime: '1:18.4'
  };
}

udpSocket.bind(20777);
