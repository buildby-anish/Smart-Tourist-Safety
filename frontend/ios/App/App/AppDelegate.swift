import UIKit
import Capacitor
import CoreBluetooth

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, CBPeripheralManagerDelegate, CBCentralManagerDelegate {

    var window: UIWindow?
    var peripheralManager: CBPeripheralManager?
    var centralManager: CBCentralManager?
    var processedSOSPackets = Set<String>()
    let serviceUUID = CBUUID(string: "505B9110-3FA1-4E6A-913A-C4345B080001")

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Setup BLE Mesh Relaying
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
        centralManager = CBCentralManager(delegate: self, queue: nil)
        // Listen for JS → native BLE advertise bridge calls
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAdvertiseBLE(_:)),
            name: NSNotification.Name("BleSosRelay_advertiseSOS"),
            object: nil
        )
        return true
    }

    // Called when the JS layer posts BleSosRelay_advertiseSOS via Capacitor bridge plugin file
    @objc func handleAdvertiseBLE(_ notification: Notification) {
        if let packet = notification.userInfo?["packet"] as? String {
            advertiseSOS(packet: packet)
        }
    }

    // MARK: - CBPeripheralManagerDelegate
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            print("iOS BLE Advertiser ready")
        }
    }

    func advertiseSOS(packet: String) {
        guard let pm = peripheralManager, pm.state == .poweredOn else { return }
        let advertisementData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
            CBAdvertisementDataLocalNameKey: "SurakshaSOS"
        ]
        
        pm.startAdvertising(advertisementData)
        print("iOS BLE SOS advertising packet: \(packet)")
    }

    // MARK: - CBCentralManagerDelegate
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
            print("iOS BLE SOS Scanning started")
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        if let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data],
           let payload = serviceData[serviceUUID],
           let packet = String(data: payload, encoding: .utf8) {
            handleSOSPacket(packet)
        }
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
        guard let url = URL(string: "https://smart-tourist-safety-production.up.railway.app/api/v1/sos/relay") else {
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
