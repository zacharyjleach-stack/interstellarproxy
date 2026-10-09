# LAN Pinger

Scan your home network, ping any device on it, and follow a 3D arrow on your phone to the one you pick.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer, on a computer connected to the network you want to scan.

```sh
npm install
npm run start:https
```

The terminal prints the addresses it's running on, for example `https://192.168.1.20:3000`. Open that address on your phone (same Wi-Fi). The certificate is self-signed, so your browser will warn you once; choose to continue.

Use `npm start` for plain HTTP if you only use it on the computer itself. Phones only allow the compass over HTTPS.

## Using it

- **Scan network** pings every address on your local network (up to 254) and lists the devices that answer, with their MAC address and hostname when available.
- **Ping / Stop** starts or stops a once-a-second check on a device. Reply times and missed replies show live. Devices that block pings (iPhones, Windows PCs) are checked over TCP instead.
- **Sound** plays a sonar ping on your screen for each reply. It can't make the other device make a noise.
- Press **Find** on a device to open the **arrow** view:
  1. Tap **Turn on compass**.
  2. Point the top of your phone at the device and tap **It's this way: save**.
  3. From then on the arrow keeps pointing at the device as you turn around.
  
  On a computer with no compass, set the direction with the slider instead (screen-up counts as north).

Names and directions are saved in `data/devices.json`.

## Why you set the direction yourself

Ordinary Wi-Fi and ping can tell you a device is on your network and how quickly it answers, but not where it is. Ping time on a home network doesn't change with distance. Finding direction automatically needs special hardware, such as ultra-wideband (AirTag-style) or Bluetooth direction-finding antennas, so the arrow uses a direction you record once.

## Notes

- Some devices (many phones, and PCs with a firewall) don't answer pings, so they won't show up in a scan.
- Only scan networks you own or have permission to scan.
