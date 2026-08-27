import UIKit
import Capacitor
import CoreBluetooth

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, CBPeripheralManagerDelegate, CBCentralManagerDelegate, CBPeripheralDelegate {

    var window: UIWindow?
    var peripheralManager: CBPeripheralManager?
    var centralManager: CBCentralManager?
    var processedSOSPackets = Set<String>()
    let serviceUUID = CBUUID(string: "505B9110-3FA1-4E6A-913A-C4345B080001")
    let characteristicUUID = CBUUID(string: "505B9110-3FA1-4E6A-913A-C4345B080002")

    var sosCharacteristic: CBMutableCharacteristic?
    var serverUrl = "https://smart-tourist-safety-production.up.railway.app/api/v1/sos/relay"

    var pendingPeripherals = Set<CBPeripheral>()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Setup BLE Mesh Relaying
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
        centralManager = CBCentralManager(delegate: self, queue: nil)

        // Listen for JS → native BLE bridge calls
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(handleCheckStatus(_:)), name: NSNotification.Name("BleSosRelay_checkStatus"), object: nil)
        nc.addObserver(self, selector: #selector(handleSetServerUrl(_:)), name: NSNotification.Name("BleSosRelay_setServerUrl"), object: nil)
        nc.addObserver(self, selector: #selector(handleAdvertiseBLE(_:)), name: NSNotification.Name("BleSosRelay_advertiseSOS"), object: nil)
        nc.addObserver(self, selector: #selector(handleAdvertiseBinaryBLE(_:)), name: NSNotification.Name("BleSosRelay_advertiseSOSBinary"), object: nil)

        return true
    }

    @objc func handleCheckStatus(_ notification: Notification) {
        guard let call = notification.userInfo?["call"] as? CAPPluginCall else { return }
        let enabled = peripheralManager?.state == .poweredOn
        let supported = peripheralManager != nil
        call.resolve([
            "enabled": enabled,
            "supported": supported
        ])
    }

    @objc func handleSetServerUrl(_ notification: Notification) {
        if let url = notification.userInfo?["url"] as? String {
            self.serverUrl = url
            print("iOS BLE Relay Server URL updated: \(url)")
        }
    }

    @objc func handleAdvertiseBLE(_ notification: Notification) {
        if let packet = notification.userInfo?["packet"] as? String {
            advertiseSOS(packet: packet)
        }
    }

    @objc func handleAdvertiseBinaryBLE(_ notification: Notification) {
        guard let touristIdStr = notification.userInfo?["touristId"] as? String,
              let lat = notification.userInfo?["latitude"] as? Double,
              let lng = notification.userInfo?["longitude"] as? Double,
              let battery = notification.userInfo?["battery"] as? Int,
              let touristId = UUID(uuidString: touristIdStr) else { return }

        var data = Data()

        // 16 bytes UUID
        let uuid = touristId.uuid
        data.append(contentsOf: [
            uuid.0, uuid.1, uuid.2, uuid.3, uuid.4, uuid.5, uuid.6, uuid.7,
            uuid.8, uuid.9, uuid.10, uuid.11, uuid.12, uuid.13, uuid.14, uuid.15
        ])

        // 4 bytes Lat (Float32, Big-Endian)
        var latFloat = Float32(lat).bitPattern.bigEndian
        withUnsafeBytes(of: &latFloat) { data.append(contentsOf: $0) }

        // 4 bytes Lng (Float32, Big-Endian)
        var lngFloat = Float32(lng).bitPattern.bigEndian
        withUnsafeBytes(of: &lngFloat) { data.append(contentsOf: $0) }

        // 1 byte Battery
        let batteryByte = Int8(battery)
        data.append(UInt8(bitPattern: batteryByte))

        // 4 bytes Timestamp (UInt32 seconds, Big-Endian)
        var timestamp = UInt32(Date().timeIntervalSince1970).bigEndian
        if let triggeredAtStr = notification.userInfo?["triggeredAt"] as? String {
            let formatter = ISO8601DateFormatter()
            if let date = formatter.date(from: triggeredAtStr) {
                timestamp = UInt32(date.timeIntervalSince1970).bigEndian
            }
        }
        withUnsafeBytes(of: &timestamp) { data.append(contentsOf: $0) }

        advertiseSOSBinary(data: data)
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
            if let charValue = sosCharacteristic?.value {
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
        self.sosCharacteristic = char
        peripheralManager?.add(service)
    }

    func advertiseSOS(packet: String) {
        guard let data = packet.data(using: .utf8) else { return }
        advertiseSOSBinary(data: data)
    }

    func advertiseSOSBinary(data: Data) {
        guard let pm = peripheralManager, pm.state == .poweredOn else { return }
        pm.stopAdvertising()

        if let char = sosCharacteristic {
            // Update the dynamic value so readers get the latest SOS
            pm.updateValue(data, for: char, onSubscribedCentrals: nil)
            // Also update the static value property for direct reads if possible
            char.value = data
        }

        let advertisementData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID]
        ]
        
        pm.startAdvertising(advertisementData)
        print("iOS BLE SOS advertising started with \(data.count) bytes")
    }

    // MARK: - CBCentralManagerDelegate
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
            print("iOS BLE SOS Scanning started")
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        // iOS doesn't always show Service Data in discovery for background peripherals.
        // We connect to the peripheral to read the SOS characteristic.
        if !pendingPeripherals.contains(peripheral) {
            pendingPeripherals.insert(peripheral)
            centralManager?.connect(peripheral, options: nil)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        pendingPeripherals.remove(peripheral)
    }

    // MARK: - CBPeripheralDelegate
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services else { return }
        for service in services where service.uuid == serviceUUID {
            peripheral.discoverCharacteristics([characteristicUUID], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let characteristics = service.characteristics else { return }
        for char in characteristics where char.uuid == characteristicUUID {
            peripheral.readValue(for: char)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }

        // Try to parse as JSON first
        if let packet = String(data: data, encoding: .utf8), packet.contains("tourist_id") {
            handleSOSPacket(packet)
        } else if data.count >= 24 {
            // Try to parse as Binary
            parseBinarySOS(data: data)
        }

        centralManager?.cancelPeripheralConnection(peripheral)
    }

    func parseBinarySOS(data: Data) {
        if data.count < 24 { return }

        let uuidData = data.subdata(in: 0..<16)
        let latData = data.subdata(in: 16..<20)
        let lngData = data.subdata(in: 20..<24)
        let battery = data.count > 24 ? Int(data[24]) : -1

        var triggeredAt: String? = nil
        if data.count >= 29 {
            let tsData = data.subdata(in: 25..<29)
            let timestamp = tsData.withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
            let date = Date(timeIntervalSince1970: TimeInterval(timestamp))
            let formatter = ISO8601DateFormatter()
            triggeredAt = formatter.string(from: date)
        }

        let touristId = UUID(uuid: (
            uuidData[0], uuidData[1], uuidData[2], uuidData[3],
            uuidData[4], uuidData[5], uuidData[6], uuidData[7],
            uuidData[8], uuidData[9], uuidData[10], uuidData[11],
            uuidData[12], uuidData[13], uuidData[14], uuidData[15]
        ))

        let latPattern = latData.withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
        let lat = Float32(bitPattern: latPattern)

        let lngPattern = lngData.withUnsafeBytes { $0.load(as: UInt32.self) }.bigEndian
        let lng = Float32(bitPattern: lngPattern)

        var jsonPacket = "{\"tourist_id\":\"\(touristId.uuidString.lowercased())\",\"latitude\":\(lat),\"longitude\":\(lng),\"battery_status\":\(battery)"
        if let ts = triggeredAt {
            jsonPacket += ",\"triggered_at\":\"\(ts)\"}"
        } else {
            jsonPacket += "}"
        }
        handleSOSPacket(jsonPacket)
    }

    func handleSOSPacket(_ packet: String) {
        if processedSOSPackets.contains(packet) { return }
        processedSOSPackets.insert(packet)
        print("New SOS Packet received via iOS BLE: \(packet)")

        relayToServer(packet: packet) { success in
            if success {
                print("SOS packet relayed to backend successfully.")
            } else {
                print("Relay failed. Re-advertising packet...")
                self.advertiseSOS(packet: packet)
            }
        }
    }

    func relayToServer(packet: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: serverUrl) else {
            completion(false)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let json: [String: Any] = ["payload": packet]
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

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused while the application was inactive.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
