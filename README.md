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
- **🔇 / 🔊** turns on a sonar sound for each reply. It plays only on the screen where you pressed Ping.

### Finding a phone, tablet or computer automatically

1. On the device you want to find, open the app's address and tap **📡 Make this device findable**. Allow location access. Leave that page open with the screen on.
2. On your phone, open the app and press **Find** on that device (it's marked 📡 findable).
3. The arrow points to it and shows roughly how far away it is, using both devices' locations. Tap **🧭 Turn on compass** so the arrow turns with you.
4. Phone locations are only accurate to a few metres (worse indoors), so when you're close, tap **🔔 Ring it**. The device sounds an alarm, vibrates and flashes until someone taps **I found it**.

iPhones stop web pages when the screen locks, so a locked iPhone can't be rung this way.

### Other devices (TVs, printers, smart plugs)

These can't run the app, so the arrow can't find them by itself. Press **Find** and show it the direction once:
1. Tap **🧭 Turn on compass**.
2. Point the top of your phone at the device and tap **It's this way: save**.
3. From then on the arrow keeps pointing at the device as you turn around.

On a computer with no compass, set the direction with the slider instead (screen-up counts as north).

Names and directions are saved in `data/devices.json`.

## Why some devices need help

Wi-Fi and ping can tell you a device is on your network, but not where it is. Ping time on a home network doesn't change with distance. So the app finds devices by asking them for their location (findable mode), or by remembering a direction you show it.

## Notes

- Some devices don't answer pings. The scan still lists them if they show up on the network some other way.
- Only scan networks you own or have permission to scan.
