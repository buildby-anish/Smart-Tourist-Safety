import UIKit
import Capacitor
import CoreBluetooth

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, CBPeripheralManagerDelegate, CBCentralManagerDelegate, CBPeripheralDelegate {

    var window: UIWindow?
    var peripheralManager: CBPeripheralManager?
    var centralManager: CBCentralManager?
    
    // UUIDs for Mesh Protocol
    let serviceUUID = CBUUID(string: "505B9110-3FA1-4E6A-913A-C4345B080001")
    let serviceUUID16 = CBUUID(string: "9110") // 16-bit Service UUID for connectionless scan
    let characteristicUUID = CBUUID(string: "505B9110-3FA1-4E6A-913A-C4345B080002")

    var meshCharacteristic: CBMutableCharacteristic?
    var serverUrl = "https://smart-tourist-safety-production.up.railway.app/api/v1/sos/relay"

    var isScanning = false
    var isAdvertising = false
    var activePacketData: Data? = nil

    var processedSosIds = Set<UUID>()
    var pendingPeripherals = Set<CBPeripheral>()
    var pendingUploads = Set<String>()

    // Enums
    static let EMERGENCY_GENERAL: UInt8 = 0
    static let EMERGENCY_MEDICAL: UInt8 = 1
    static let EMERGENCY_FIRE: UInt8 = 2
    static let EMERGENCY_NATURAL_DISASTER: UInt8 = 3
    static let EMERGENCY_ACCIDENT: UInt8 = 4
    static let EMERGENCY_THREAT: UInt8 = 5

    static let SEVERITY_LOW: UInt8 = 0
    static let SEVERITY_MEDIUM: UInt8 = 1
    static let SEVERITY_HIGH: UInt8 = 2
    static let SEVERITY_CRITICAL: UInt8 = 3

    static func getEmergencyTypeCode(type: String?) -> UInt8 {
        guard let type = type else { return EMERGENCY_GENERAL }
        switch type.uppercased() {
        case "MEDICAL": return EMERGENCY_MEDICAL
        case "FIRE": return EMERGENCY_FIRE
        case "NATURAL_DISASTER", "NATURAL": return EMERGENCY_NATURAL_DISASTER
        case "ACCIDENT": return EMERGENCY_ACCIDENT
        case "THREAT": return EMERGENCY_THREAT
        default: return EMERGENCY_GENERAL
        }
    }

    static func getEmergencyTypeString(code: UInt8) -> String {
        switch code {
        case EMERGENCY_MEDICAL: return "MEDICAL"
        case EMERGENCY_FIRE: return "FIRE"
        case EMERGENCY_NATURAL_DISASTER: return "NATURAL_DISASTER"
        case EMERGENCY_ACCIDENT: return "ACCIDENT"
        case EMERGENCY_THREAT: return "THREAT"
        default: return "GENERAL"
        }
    }

    static func getSeverityCode(severity: String?) -> UInt8 {
        guard let severity = severity else { return SEVERITY_HIGH }
        switch severity.uppercased() {
        case "LOW": return SEVERITY_LOW
        case "MEDIUM": return SEVERITY_MEDIUM
        case "CRITICAL": return SEVERITY_CRITICAL
        default: return SEVERITY_HIGH
        }
    }

    static func getSeverityString(code: UInt8) -> String {
        switch code {
        case SEVERITY_LOW: return "LOW"
        case SEVERITY_MEDIUM: return "MEDIUM"
        case SEVERITY_CRITICAL: return "CRITICAL"
        default: return "HIGH"
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Setup CoreBluetooth
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
        centralManager = CBCentralManager(delegate: self, queue: nil)

        // Setup notification observers for JS bridge calls
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(handleStartMesh(_:)), name: NSNotification.Name("SosMesh_startMesh"), object: nil)
        nc.addObserver(self, selector: #selector(handleStopMesh(_:)), name: NSNotification.Name("SosMesh_stopMesh"), object: nil)
        nc.addObserver(self, selector: #selector(handleSendSOS(_:)), name: NSNotification.Name("SosMesh_sendSOS"), object: nil)
        nc.addObserver(self, selector: #selector(handleGetStatus(_:)), name: NSNotification.Name("SosMesh_getStatus"), object: nil)

        return true
    }

    @objc func handleStartMesh(_ notification: Notification) {
        startScanning()
        if let data = activePacketData {
            startAdvertising(data: data)
        }
    }

    @objc func handleStopMesh(_ notification: Notification) {
        stopScanning()
        stopAdvertising()
    }

    @objc func handleSendSOS(_ notification: Notification) {
        guard let touristIdStr = notification.userInfo?["touristId"] as? String,
              let lat = notification.userInfo?["latitude"] as? Double,
              let lng = notification.userInfo?["longitude"] as? Double,
              let battery = notification.userInfo?["battery"] as? Int,
              let touristId = UUID(uuidString: touristIdStr) else { return }

        let sosIdStr = notification.userInfo?["sosId"] as? String
        // Was: force-unwrapping UUID(uuidString: sosIdStr!)! — if the JS
        // side ever sends a sosId that's a non-empty but malformed UUID
        // string, UUID(uuidString:) returns nil and the second "!" crashes
        // the whole app. Fall back to a freshly generated UUID instead.
        let sosId: UUID = {
            if let str = sosIdStr, !str.isEmpty, let parsed = UUID(uuidString: str) {
                return parsed
            }
            return UUID()
        }()
        let emergencyType = notification.userInfo?["emergencyType"] as? String ?? "GENERAL"
        let severity = notification.userInfo?["severity"] as? String ?? "HIGH"

        let timestamp = UInt32(Date().timeIntervalSince1970)
        let batteryByte = UInt8(clamping: battery)
        let typeCode = AppDelegate.getEmergencyTypeCode(type: emergencyType)
        let severityCode = AppDelegate.getSeverityCode(severity: severity)
        let hopCount: UInt8 = 0
        let ttl: UInt8 = 3

        let packedData = packSosMesh(
            sosId: sosId, touristId: touristId, latitude: Float(lat), longitude: Float(lng),
            timestamp: timestamp, battery: batteryByte, emergencyType: typeCode, severity: severityCode,
            hopCount: hopCount, ttl: ttl
        )

        processedSosIds.insert(sosId)
        activePacketData = packedData
        meshCharacteristic?.value = packedData

        startAdvertising(data: packedData)
        startScanning()
    }

    @objc func handleGetStatus(_ notification: Notification) {
        guard let call = notification.userInfo?["call"] as? CAPPluginCall else { return }
        let enabled = peripheralManager?.state == .poweredOn
        let status: [String: Any] = [
            "isScanning": isScanning,
            "isAdvertising": isAdvertising,
            "bluetoothState": enabled ? "ON" : "OFF"
        ]
        call.resolve(status)
    }

    // Binary packer for iOS (49 bytes)
    func packSosMesh(
        sosId: UUID, touristId: UUID, latitude: Float, longitude: Float,
        timestamp: UInt32, battery: UInt8, emergencyType: UInt8, severity: UInt8,
        hopCount: UInt8, ttl: UInt8
    ) -> Data {
        var data = Data()
        
        let sosUuid = sosId.uuid
        data.append(contentsOf: [
            sosUuid.0, sosUuid.1, sosUuid.2, sosUuid.3, sosUuid.4, sosUuid.5, sosUuid.6, sosUuid.7,
            sosUuid.8, sosUuid.9, sosUuid.10, sosUuid.11, sosUuid.12, sosUuid.13, sosUuid.14, sosUuid.15
        ])
        
        let touristUuid = touristId.uuid
        data.append(contentsOf: [
            touristUuid.0, touristUuid.1, touristUuid.2, touristUuid.3, touristUuid.4, touristUuid.5, touristUuid.6, touristUuid.7,
            touristUuid.8, touristUuid.9, touristUuid.10, touristUuid.11, touristUuid.12, touristUuid.13, touristUuid.14, touristUuid.15
        ])
        
        var latFloat = latitude.bitPattern.bigEndian
        withUnsafeBytes(of: &latFloat) { data.append(contentsOf: $0) }
        
        var lngFloat = longitude.bitPattern.bigEndian
        withUnsafeBytes(of: &lngFloat) { data.append(contentsOf: $0) }
        
        var ts = timestamp.bigEndian
        withUnsafeBytes(of: &ts) { data.append(contentsOf: $0) }
        
        data.append(battery)
        data.append(emergencyType)
        data.append(severity)
        data.append(hopCount)
        data.append(ttl)
        
        return data
    }

    struct SosMeshPacket {
        var sosId: UUID
        var touristId: UUID
        var latitude: Float
        var longitude: Float
        var timestamp: UInt32
        var battery: UInt8
        var emergencyType: String
        var severity: String
        var hopCount: UInt8
        var ttl: UInt8
        
        static func unpack(data: Data) -> SosMeshPacket? {
            guard data.count >= 49 else { return nil }
            
            let sosUuidBytes = data.subdata(in: 0..<16)
            let sosId = UUID(uuid: (
                sosUuidBytes[0], sosUuidBytes[1], sosUuidBytes[2], sosUuidBytes[3],
                sosUuidBytes[4], sosUuidBytes[5], sosUuidBytes[6], sosUuidBytes[7],
                sosUuidBytes[8], sosUuidBytes[9], sosUuidBytes[10], sosUuidBytes[11],
                sosUuidBytes[12], sosUuidBytes[13], sosUuidBytes[14], sosUuidBytes[15]
            ))
            
            let touristUuidBytes = data.subdata(in: 16..<32)
            let touristId = UUID(uuid: (
                touristUuidBytes[0], touristUuidBytes[1], touristUuidBytes[2], touristUuidBytes[3],
                touristUuidBytes[4], touristUuidBytes[5], touristUuidBytes[6], touristUuidBytes[7],
                touristUuidBytes[8], touristUuidBytes[9], touristUuidBytes[10], touristUuidBytes[11],
                touristUuidBytes[12], touristUuidBytes[13], touristUuidBytes[14], touristUuidBytes[15]
            ))
            
            let latPattern = data.subdata(in: 32..<36).withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
            let latitude = Float(bitPattern: latPattern)
            
            let lngPattern = data.subdata(in: 36..<40).withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
            let longitude = Float(bitPattern: lngPattern)
            
            let tsPattern = data.subdata(in: 40..<44).withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
            let timestamp = tsPattern
            
            let battery = data[44]
            let emergencyType = AppDelegate.getEmergencyTypeString(code: data[45])
            let severity = AppDelegate.getSeverityString(code: data[46])
            let hopCount = data[47]
            let ttl = data[48]
            
            return SosMeshPacket(
                sosId: sosId, touristId: touristId, latitude: latitude, longitude: longitude,
                timestamp: timestamp, battery: battery, emergencyType: emergencyType, severity: severity,
                hopCount: hopCount, ttl: ttl
            )
        }
        
        func toJSONString() -> String {
            let formatter = ISO8601DateFormatter()
            let date = Date(timeIntervalSince1970: TimeInterval(timestamp))
            let triggeredAt = formatter.string(from: date)
            
            let dict: [String: Any] = [
                "tourist_id": touristId.uuidString.lowercased(),
                "latitude": latitude,
                "longitude": longitude,
                "battery_status": battery,
                "triggered_at": triggeredAt,
                "sos_id": sosId.uuidString.lowercased(),
                "emergency_type": emergencyType,
                "severity": severity,
                "hop_count": hopCount,
                "ttl": ttl
            ]
            
            if let jsonData = try? JSONSerialization.data(withJSONObject: dict, options: []),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                return jsonString
            }
            return "{}"
        }
    }

    // MARK: - CBPeripheralManagerDelegate
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            print("iOS BLE Peripheral Manager ready")
            setupSOSService()
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        if request.characteristic.uuid == characteristicUUID {
            if let charValue = meshCharacteristic?.value {
                if request.offset > charValue.count {
                    peripheral.respond(to: request, withResult: .invalidOffset)
                    return
                }
                request.value = charValue.subdata(in: request.offset..<charValue.count)
                peripheral.respond(to: request, withResult: .success)
            } else {
                peripheral.respond(to: request, withResult: .requestNotSupported)
            }
        }
    }

    func setupSOSService() {
        let char = CBMutableCharacteristic(
            type: characteristicUUID,
            properties: [.read, .notify],
            value: nil,
            permissions: [.readable]
        )
        let service = CBMutableService(type: serviceUUID, primary: true)
        service.characteristics = [char]
        self.meshCharacteristic = char
        peripheralManager?.add(service)
    }

    func startAdvertising(data: Data) {
        guard let pm = peripheralManager, pm.state == .poweredOn else { return }
        pm.stopAdvertising()

        if let char = meshCharacteristic {
            char.value = data
            pm.updateValue(data, for: char, onSubscribedCentrals: nil)
        }

        let advertisementData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID]
        ]
        
        pm.startAdvertising(advertisementData)
        isAdvertising = true
        print("iOS BLE SOS Mesh advertising started")
    }

    func stopAdvertising() {
        peripheralManager?.stopAdvertising()
        isAdvertising = false
        print("iOS BLE SOS Mesh advertising stopped")
    }

    // MARK: - CBCentralManagerDelegate
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn && isScanning {
            central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
            print("iOS BLE SOS Mesh Scanning started")
        }
    }

    func startScanning() {
        isScanning = true
        if centralManager?.state == .poweredOn {
            centralManager?.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
            print("iOS BLE SOS Mesh Scanning started")
        }
    }

    func stopScanning() {
        centralManager?.stopScan()
        isScanning = false
        print("iOS BLE SOS Mesh Scanning stopped")
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        if !pendingPeripherals.contains(peripheral) {
            pendingPeripherals.insert(peripheral)
            centralManager?.connect(peripheral, options: nil)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        // Was missing entirely. Without this, a peripheral whose connect()
        // call fails (out of range, radio busy, etc.) stayed in
        // pendingPeripherals forever — didDiscover's dedup check
        // ("if !pendingPeripherals.contains(peripheral)") then silently
        // refused to ever retry connecting to that peripheral again for
        // the lifetime of the app.
        print("iOS BLE SOS Mesh: failed to connect to \(peripheral.identifier): \(error?.localizedDescription ?? "unknown error")")
        pendingPeripherals.remove(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        pendingPeripherals.remove(peripheral)
    }

    // MARK: - CBPeripheralDelegate
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        // Was: guard returned on error/no-match without ever disconnecting,
        // leaking the GATT connection — same failure mode as the Android
        // scanner's equivalent bug (must close on !GATT_SUCCESS). Every
        // peripheral that failed here or didn't expose the mesh service
        // stayed connected indefinitely, eventually exhausting the
        // platform's concurrent-GATT-connection limit and blocking all
        // future mesh reads.
        guard error == nil, let services = peripheral.services,
              services.contains(where: { $0.uuid == serviceUUID }) else {
            centralManager?.cancelPeripheralConnection(peripheral)
            return
        }
        for service in services where service.uuid == serviceUUID {
            peripheral.discoverCharacteristics([characteristicUUID], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        // Same leak as above, same fix: disconnect on error or on a
        // service that doesn't actually expose our characteristic, instead
        // of silently returning and holding the connection open forever.
        guard error == nil, let characteristics = service.characteristics,
              characteristics.contains(where: { $0.uuid == characteristicUUID }) else {
            centralManager?.cancelPeripheralConnection(peripheral)
            return
        }
        for char in characteristics where char.uuid == characteristicUUID {
            peripheral.readValue(for: char)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else {
            centralManager?.cancelPeripheralConnection(peripheral)
            return
        }

        if data.count == 49 {
            handleIncomingMeshPacket(data: data)
        }

        centralManager?.cancelPeripheralConnection(peripheral)
    }

    func handleIncomingMeshPacket(data: Data) {
        guard let packet = SosMeshPacket.unpack(data: data) else { return }

        if processedSosIds.contains(packet.sosId) { return }
        processedSosIds.insert(packet.sosId)

        print("Received SOS Mesh Packet! SOS ID: \(packet.sosId), Hops: \(packet.hopCount)")

        // Notify JS layer via notification bridge
        let notificationData: [String: Any] = [
            "sosId": packet.sosId.uuidString,
            "touristId": packet.touristId.uuidString,
            "latitude": Double(packet.latitude),
            "longitude": Double(packet.longitude),
            "battery": Int(packet.battery),
            "emergencyType": packet.emergencyType,
            "severity": packet.severity,
            "hopCount": Int(packet.hopCount),
            "ttl": Int(packet.ttl)
        ]
        
        NotificationCenter.default.post(
            name: NSNotification.Name("SosMesh_onSOSReceived"),
            object: nil,
            userInfo: notificationData
        )

        let jsonString = packet.toJSONString()

        // Check internet and upload or relay
        if NetworkReachability.isOnline() {
            uploadRelayPacket(jsonString: jsonString) { success in
                if success {
                    print("Relayed SOS packet to backend successfully.")
                    NotificationCenter.default.post(
                        name: NSNotification.Name("SosMesh_onSOSDelivered"),
                        object: nil,
                        userInfo: ["sosId": packet.sosId.uuidString]
                    )
                } else {
                    print("Relay failed. Queueing and starting BLE forwarding...")
                    self.pendingUploads.insert(jsonString)
                    self.forwardOfflinePacket(packet: packet)
                }
            }
        } else {
            print("Offline. Forwarding SOS packet via BLE...")
            self.pendingUploads.insert(jsonString)
            self.forwardOfflinePacket(packet: packet)
        }
    }

    func forwardOfflinePacket(packet: SosMeshPacket) {
        guard packet.ttl > 1 else {
            print("TTL expired. Dropping packet.")
            return
        }

        let newHopCount = packet.hopCount + 1
        let newTtl = packet.ttl - 1
        let typeCode = AppDelegate.getEmergencyTypeCode(type: packet.emergencyType)
        let severityCode = AppDelegate.getSeverityCode(severity: packet.severity)

        let relayedData = packSosMesh(
            sosId: packet.sosId, touristId: packet.touristId, latitude: packet.latitude, longitude: packet.longitude,
            timestamp: packet.timestamp, battery: packet.battery, emergencyType: typeCode, severity: severityCode,
            hopCount: newHopCount, ttl: newTtl
        )

        activePacketData = relayedData
        meshCharacteristic?.value = relayedData

        startAdvertising(data: relayedData)

        NotificationCenter.default.post(
            name: NSNotification.Name("SosMesh_onSOSRelayed"),
            object: nil,
            userInfo: ["sosId": packet.sosId.uuidString, "hopCount": Int(newHopCount)]
        )
    }

    func uploadRelayPacket(jsonString: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: serverUrl) else {
            completion(false)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let json: [String: Any] = ["payload": jsonString]
        request.httpBody = try? JSONSerialization.data(withJSONObject: json)

        let task = URLSession.shared.dataTask(with: request) { _, response, _ in
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 || httpResponse.statusCode == 201 {
                completion(true)
            } else {
                completion(false)
            }
        }
        task.resume()
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// Simple Network reachability check helper for iOS
struct NetworkReachability {
    static func isOnline() -> Bool {
        // Basic online check; actual Capacitor client does online listener check
        // Return true as a fallback so URLSession tries to execute
        return true
    }
}
