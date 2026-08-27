import Capacitor

/// Capacitor plugin that exposes SosMesh to the JS layer.
@objc(SosMeshPlugin)
public class SosMeshPlugin: CAPPlugin {
    
    @objc func startMesh(_ call: CAPPluginCall) {
        NotificationCenter.default.post(
            name: NSNotification.Name("SosMesh_startMesh"),
            object: nil,
            userInfo: nil
        )
        call.resolve()
    }

    @objc func stopMesh(_ call: CAPPluginCall) {
        NotificationCenter.default.post(
            name: NSNotification.Name("SosMesh_stopMesh"),
            object: nil,
            userInfo: nil
        )
        call.resolve()
    }

    @objc func sendSOS(_ call: CAPPluginCall) {
        let sosId = call.getString("sosId") ?? ""
        let touristId = call.getString("touristId") ?? ""
        let lat = call.getDouble("latitude") ?? 0.0
        let lng = call.getDouble("longitude") ?? 0.0
        let battery = call.getInt("battery") ?? 100
        let emergencyType = call.getString("emergencyType") ?? "GENERAL"
        let severity = call.getString("severity") ?? "HIGH"
        
        NotificationCenter.default.post(
            name: NSNotification.Name("SosMesh_sendSOS"),
            object: nil,
            userInfo: [
                "sosId": sosId,
                "touristId": touristId,
                "latitude": lat,
                "longitude": lng,
                "battery": battery,
                "emergencyType": emergencyType,
                "severity": severity
            ]
        )
        call.resolve()
    }

    @objc func getMeshStatus(_ call: CAPPluginCall) {
        NotificationCenter.default.post(
            name: NSNotification.Name("SosMesh_getStatus"),
            object: nil,
            userInfo: ["call": call]
        )
    }

    public override func load() {
        super.load()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onSOSReceived(_:)), name: NSNotification.Name("SosMesh_onSOSReceived"), object: nil)
        nc.addObserver(self, selector: #selector(onSOSRelayed(_:)), name: NSNotification.Name("SosMesh_onSOSRelayed"), object: nil)
        nc.addObserver(self, selector: #selector(onSOSDelivered(_:)), name: NSNotification.Name("SosMesh_onSOSDelivered"), object: nil)
    }

    @objc func onSOSReceived(_ notification: Notification) {
        if let info = notification.userInfo as? [String: Any] {
            notifyListeners("onSOSReceived", data: info)
        }
    }

    @objc func onSOSRelayed(_ notification: Notification) {
        if let info = notification.userInfo as? [String: Any] {
            notifyListeners("onSOSRelayed", data: info)
        }
    }

    @objc func onSOSDelivered(_ notification: Notification) {
        if let info = notification.userInfo as? [String: Any] {
            notifyListeners("onSOSDelivered", data: info)
        }
    }
}
