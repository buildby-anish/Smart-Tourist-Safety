import Capacitor

/// Capacitor plugin that exposes BleSosRelay.advertiseSOS() to the JS layer.
/// When the tourist's device triggers an SOS offline, the React app calls this
/// plugin which posts a notification that AppDelegate picks up to start BLE advertising.
@objc(BleSosRelayPlugin)
public class BleSosRelayPlugin: CAPPlugin {
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
}
