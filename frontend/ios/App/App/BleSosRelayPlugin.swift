import Capacitor

/// Capacitor plugin that exposes BleSosRelay.advertiseSOS() to the JS layer.
/// When the tourist's device triggers an SOS offline, the React app calls this
/// plugin which posts a notification that AppDelegate picks up to start BLE advertising.
@objc(BleSosRelayPlugin)
public class BleSosRelayPlugin: CAPPlugin {
    @objc func checkStatus(_ call: CAPPluginCall) {
        NotificationCenter.default.post(
            name: NSNotification.Name("BleSosRelay_checkStatus"),
            object: nil,
            userInfo: ["call": call]
        )
    }

    @objc func setServerUrl(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        if !url.isEmpty {
            NotificationCenter.default.post(
                name: NSNotification.Name("BleSosRelay_setServerUrl"),
                object: nil,
                userInfo: ["url": url]
            )
        }
        call.resolve()
    }

    @objc func advertiseSOS(_ call: CAPPluginCall) {
        let packet = call.getString("packet") ?? ""
        if !packet.isEmpty {
            NotificationCenter.default.post(
                name: NSNotification.Name("BleSosRelay_advertiseSOS"),
                object: nil,
                userInfo: ["packet": packet]
            )
        }
        call.resolve()
    }

    @objc func advertiseSOSBinary(_ call: CAPPluginCall) {
        let touristId = call.getString("touristId") ?? ""
        let lat = call.getDouble("latitude") ?? 0.0
        let lng = call.getDouble("longitude") ?? 0.0
        let battery = call.getInt("battery") ?? -1

        if !touristId.isEmpty {
            NotificationCenter.default.post(
                name: NSNotification.Name("BleSosRelay_advertiseSOSBinary"),
                object: nil,
                userInfo: [
                    "touristId": touristId,
                    "latitude": lat,
                    "longitude": lng,
                    "battery": battery
                ]
            )
        }
        call.resolve()
    }
}
