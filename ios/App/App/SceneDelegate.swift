import UIKit
import Capacitor
import Security
import CoreBluetooth

/*
 Antogo for iPhone and iPad (24 Nov 2026). Every page is packed inside the app (App/public, copied from the same pages
 the web version and the Mac app publish) and runs in Apple's own web engine, as every iOS app must. This file holds
 the app's own small side: the few things a page may not do, offered to the pages as the "AntogoNative" plugin and
 wrapped by src/shell.ts in the same shape as the Mac app's.

 - fetch: asks one of the services a rider connects (Garmin with a personal key, Intervals.icu, the rider's AI
   provider) on the pages' behalf. It reaches those addresses only; it is not a general way out to the internet.
 - keyRead / keySave / keyForget: the Garmin key, kept in the iPhone's own password store (the Keychain), on this
   device only: never in the app's data, a backup, or iCloud.
 - share: hands files (a backup, exported rides) to the system's share and save sheet: Files, iCloud Drive, AirDrop.
 - bt… : the iPhone's or iPad's own Bluetooth (25 Nov 2026), for the ride player: finding trainers and sensors nearby,
   connecting, reading, writing and listening. Apple's web engine has no Bluetooth, so the pages reach it here; the
   pages decide what to say to a device (src/player/ble), this side only carries it.
 - keepAwake: keeps the screen on during a ride, and lets it dim again afterwards.
 - selfTest / report: only in the test build the publishing machine runs in Apple's simulator (never in the app riders
   get): whether a self-test was asked for, and where its result is written.
 */

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AntogoBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }
}

/// The page's window, with Antogo's own plugin registered before the pages load.
class AntogoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AntogoNativePlugin())
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        // The page's own dark background shows behind the notch and the home bar while it draws.
        let graphite = UIColor(red: 0x0B / 255.0, green: 0x0E / 255.0, blue: 0x14 / 255.0, alpha: 1)
        view.backgroundColor = graphite
        webView?.isOpaque = false
        webView?.backgroundColor = graphite
        webView?.scrollView.backgroundColor = graphite
    }
}

@objc(AntogoNativePlugin)
public class AntogoNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AntogoNativePlugin"
    public let jsName = "AntogoNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keyRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keySave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keyForget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btStopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btKnown", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btConnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btDisconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btDiscover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btNotify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selfTest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "report", returnType: CAPPluginReturnPromise),
    ]

    // MARK: the services a rider connects, and nothing else

    /// The only places the app's own side may ask: Garmin (personal key), Intervals.icu, and the AI providers a rider
    /// may bring their own key for.
    static let allowedHosts: Set<String> = [
        "personal.connectapi.garmin.com",
        "intervals.icu",
        "api.anthropic.com",
        "api.openai.com",
        "generativelanguage.googleapis.com",
    ]
    static let garmin = "https://personal.connectapi.garmin.com/"

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 60
        c.timeoutIntervalForResource = 600
        c.httpCookieStorage = nil
        c.urlCache = nil
        return URLSession(configuration: c)
    }()

    @objc func fetch(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), var url = URL(string: raw), url.scheme == "https",
              let host = url.host, AntogoNativePlugin.allowedHosts.contains(host) else {
            call.reject("Only the services you connect can be asked this way.")
            return
        }
        #if DEBUG
        // The simulator self-test only: Garmin is answered by a stand-in on the test machine.
        if let base = ProcessInfo.processInfo.environment["ANTOGO_GARMIN_BASE"], raw.hasPrefix(AntogoNativePlugin.garmin),
           let standIn = URL(string: base + raw.dropFirst(AntogoNativePlugin.garmin.count)) {
            url = standIn
        }
        #endif
        var req = URLRequest(url: url)
        req.httpMethod = call.getString("method") ?? "GET"
        for (k, v) in call.getObject("headers") ?? [:] { if let s = v as? String { req.setValue(s, forHTTPHeaderField: k) } }
        if let body = call.getString("body"), let data = Data(base64Encoded: body) { req.httpBody = data }
        session.dataTask(with: req) { data, response, error in
            if let error = error { call.reject(error.localizedDescription); return }
            let http = response as? HTTPURLResponse
            call.resolve([
                "status": http?.statusCode ?? 0,
                "type": http?.value(forHTTPHeaderField: "Content-Type") ?? "",
                "body": (data ?? Data()).base64EncodedString(),
            ])
        }.resume()
    }

    // MARK: the Garmin key, in the Keychain, on this device only

    private static let service = "Antogo"
    private static let account = "garmin-personal-key"
    private func keyQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: AntogoNativePlugin.service,
         kSecAttrAccount as String: AntogoNativePlugin.account]
    }

    @objc func keyRead(_ call: CAPPluginCall) {
        var q = keyQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecSuccess, let data = out as? Data, let s = String(data: data, encoding: .utf8) {
            call.resolve(["saved": s])
        } else {
            call.resolve([:])
        }
    }

    @objc func keySave(_ call: CAPPluginCall) {
        guard let saved = call.getString("saved"), let data = saved.data(using: .utf8) else { call.reject("No key given."); return }
        SecItemDelete(keyQuery() as CFDictionary)
        var q = keyQuery()
        q[kSecValueData as String] = data
        // Readable once the iPhone has been unlocked after starting; never leaves this device (no iCloud, no backup).
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecSuccess { call.resolve() } else { call.reject("The iPhone's password store did not accept the key (\(status)).") }
    }

    @objc func keyForget(_ call: CAPPluginCall) {
        SecItemDelete(keyQuery() as CFDictionary)
        call.resolve()
    }

    // MARK: files to the share and save sheet

    @objc func share(_ call: CAPPluginCall) {
        let items = call.getArray("files", JSObject.self) ?? []
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share-\(UUID().uuidString)", isDirectory: true)
        var urls: [URL] = []
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for item in items {
                guard let name = item["name"] as? String, let b64 = item["data"] as? String, let data = Data(base64Encoded: b64) else { continue }
                // A file name only: never a path that could reach outside the folder made for it.
                let safe = (name as NSString).lastPathComponent.replacingOccurrences(of: "/", with: "-")
                let url = dir.appendingPathComponent(safe.isEmpty ? "Antogo file" : safe)
                try data.write(to: url, options: .atomic)
                urls.append(url)
            }
        } catch {
            call.reject("The file could not be prepared: \(error.localizedDescription)")
            return
        }
        if urls.isEmpty { call.reject("Nothing to save."); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("No window to show the sheet in."); return }
            let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
            if let pop = sheet.popoverPresentationController {
                // iPad: the sheet points at the middle of the window.
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                try? FileManager.default.removeItem(at: dir)
                call.resolve(["completed": completed])
            }
            vc.present(sheet, animated: true)
        }
    }

    // MARK: Bluetooth, for the ride player

    private lazy var bluetooth: AntogoBluetooth = {
        let b = AntogoBluetooth()
        b.send = { [weak self] event, data in self?.notifyListeners(event, data: data) }
        return b
    }()
    private func onMain(_ work: @escaping () -> Void) { DispatchQueue.main.async(execute: work) }

    @objc func btState(_ call: CAPPluginCall) { onMain { self.bluetooth.state(call) } }
    @objc func btScan(_ call: CAPPluginCall) { onMain { self.bluetooth.scan(call) } }
    @objc func btStopScan(_ call: CAPPluginCall) { onMain { self.bluetooth.stopScan(call) } }
    @objc func btKnown(_ call: CAPPluginCall) { onMain { self.bluetooth.known(call) } }
    @objc func btConnect(_ call: CAPPluginCall) { onMain { self.bluetooth.connect(call) } }
    @objc func btDisconnect(_ call: CAPPluginCall) { onMain { self.bluetooth.disconnect(call) } }
    @objc func btDiscover(_ call: CAPPluginCall) { onMain { self.bluetooth.discover(call) } }
    @objc func btRead(_ call: CAPPluginCall) { onMain { self.bluetooth.read(call) } }
    @objc func btWrite(_ call: CAPPluginCall) { onMain { self.bluetooth.write(call) } }
    @objc func btNotify(_ call: CAPPluginCall) { onMain { self.bluetooth.notify(call) } }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        onMain {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    // MARK: the simulator self-test (test build only)

    @objc func selfTest(_ call: CAPPluginCall) {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        call.resolve(["requested": env["ANTOGO_SELFTEST"] == "1", "run": env["ANTOGO_SELFTEST_RUN"] ?? "1"])
        #else
        call.resolve(["requested": false])
        #endif
    }

    @objc func report(_ call: CAPPluginCall) {
        #if DEBUG
        guard let text = call.getString("text"), let name = call.getString("name"),
              let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { call.reject("Nothing to report."); return }
        let safe = (name as NSString).lastPathComponent
        do { try text.write(to: docs.appendingPathComponent(safe), atomically: true, encoding: .utf8); call.resolve() }
        catch { call.reject(error.localizedDescription) }
        #else
        call.reject("Not in this build.")
        #endif
    }
}

/*
 The iPhone's and iPad's Bluetooth for the ride player (25 Nov 2026). Everything here runs on the main queue. It knows
 nothing of trainers or straps: it finds devices, connects, and carries bytes to and from the services and
 characteristics the pages name. Names of services and characteristics cross to the pages in one full lower-case form.
 */
final class AntogoBluetooth: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    /// How events reach the pages: "btFound", "btValue", "btDisconnected".
    var send: ((String, [String: Any]) -> Void)?

    private var central: CBCentralManager?
    private var stateWaiters: [(CBManagerState) -> Void] = []
    private var peripherals: [UUID: CBPeripheral] = [:]

    // The search
    private var scanning = false
    private var foundOrder: [UUID] = []
    private var foundName: [UUID: String] = [:]
    private var foundServices: [UUID: Set<String>] = [:]

    // Calls waiting for the device to answer
    private var connectCalls: [UUID: CAPPluginCall] = [:]
    private var serviceWaiters: [UUID: [() -> Void]] = [:]
    private var servicesKnown: Set<UUID> = []
    private var characteristicCalls: [String: [CAPPluginCall]] = [:]
    private var readCalls: [String: [CAPPluginCall]] = [:]
    private var writeCalls: [String: [CAPPluginCall]] = [:]
    private var notifyCalls: [String: [CAPPluginCall]] = [:]

    // MARK: names

    static func full(_ u: CBUUID) -> String {
        let s = u.uuidString.lowercased()
        if s.count == 4 { return "0000" + s + "-0000-1000-8000-00805f9b34fb" }
        if s.count == 8 { return s + "-0000-1000-8000-00805f9b34fb" }
        return s
    }
    private func key(_ p: CBPeripheral, _ service: CBUUID, _ characteristic: CBUUID? = nil) -> String {
        var k = p.identifier.uuidString + "|" + AntogoBluetooth.full(service)
        if let c = characteristic { k += "|" + AntogoBluetooth.full(c) }
        return k
    }
    private static func word(_ s: CBManagerState) -> String {
        switch s {
        case .poweredOn: return "on"
        case .poweredOff: return "off"
        case .unauthorized: return "denied"
        case .unsupported: return "unsupported"
        default: return "unknown"
        }
    }

    // MARK: whether Bluetooth can be used

    /// Asks iOS for Bluetooth the first time (the rider sees its permission question then), and answers once its state is known.
    private func whenKnown(_ done: @escaping (CBManagerState) -> Void) {
        if central == nil { central = CBCentralManager(delegate: self, queue: nil) }
        guard let c = central else { done(.unsupported); return }
        if c.state == .unknown || c.state == .resetting {
            stateWaiters.append(done)
            // A state that never settles is answered as it stands, so a page is never left waiting.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                guard let self = self, !self.stateWaiters.isEmpty, let c = self.central else { return }
                let waiting = self.stateWaiters
                self.stateWaiters = []
                waiting.forEach { $0(c.state) }
            }
        } else {
            done(c.state)
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let s = central.state
        if s == .unknown || s == .resetting { return }
        let waiting = stateWaiters
        stateWaiters = []
        waiting.forEach { $0(s) }
        if s != .poweredOn {
            // Bluetooth went away: every link is gone, and the pages hear of each.
            scanning = false
            for p in peripherals.values { dropped(p, why: "Bluetooth was turned off.") }
        }
    }

    func state(_ call: CAPPluginCall) {
        whenKnown { s in call.resolve(["state": AntogoBluetooth.word(s)]) }
    }

    // MARK: finding devices

    func scan(_ call: CAPPluginCall) {
        let services = (call.getArray("services", String.self) ?? []).map { CBUUID(string: $0) }
        whenKnown { s in
            guard s == .poweredOn, let c = self.central else { call.reject(AntogoBluetooth.word(s)); return }
            self.foundOrder = []
            self.foundName = [:]
            self.foundServices = [:]
            self.scanning = true
            // A device this iPhone already holds a link to (through another app, or its own settings) does not announce
            // itself: such devices are asked for by each service wanted.
            for service in services {
                for p in c.retrieveConnectedPeripherals(withServices: [service]) {
                    self.note(p, name: p.name, services: [service])
                }
            }
            c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
            call.resolve()
            self.publish()
        }
    }

    func stopScan(_ call: CAPPluginCall) {
        if scanning, let c = central, c.state == .poweredOn { c.stopScan() }
        scanning = false
        call.resolve()
    }

    private func note(_ p: CBPeripheral, name: String?, services: [CBUUID]) {
        let id = p.identifier
        peripherals[id] = p
        if foundServices[id] == nil { foundOrder.append(id); foundServices[id] = [] }
        for s in services { foundServices[id]?.insert(AntogoBluetooth.full(s)) }
        if let n = name, !n.isEmpty { foundName[id] = n }
    }

    private func publish() {
        let devices: [[String: Any]] = foundOrder.map { id in
            ["id": id.uuidString, "name": foundName[id] ?? "", "services": Array(foundServices[id] ?? [])]
        }
        send?("btFound", ["devices": devices])
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard scanning else { return }
        var services: [CBUUID] = []
        if let a = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] { services += a }
        if let a = advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] { services += a }
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name
        note(peripheral, name: name, services: services)
        publish()
    }

    /// Devices chosen before, by the ids the pages kept, where this iPhone still knows them.
    func known(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids", String.self) ?? []).compactMap { UUID(uuidString: $0) }
        whenKnown { s in
            guard s == .poweredOn, let c = self.central else { call.resolve(["devices": []]); return }
            var out: [[String: Any]] = []
            for p in c.retrievePeripherals(withIdentifiers: ids) {
                self.peripherals[p.identifier] = p
                out.append(["id": p.identifier.uuidString, "name": p.name ?? ""])
            }
            call.resolve(["devices": out])
        }
    }

    private func peripheral(_ call: CAPPluginCall) -> CBPeripheral? {
        guard let raw = call.getString("id"), let id = UUID(uuidString: raw) else { return nil }
        if let p = peripherals[id] { return p }
        if let c = central, c.state == .poweredOn, let p = c.retrievePeripherals(withIdentifiers: [id]).first {
            peripherals[id] = p
            return p
        }
        return nil
    }

    // MARK: connecting

    func connect(_ call: CAPPluginCall) {
        whenKnown { s in
            guard s == .poweredOn, let c = self.central else { call.reject("Bluetooth is " + AntogoBluetooth.word(s) + "."); return }
            guard let p = self.peripheral(call) else { call.reject("This device is not known here."); return }
            let id = p.identifier
            // One attempt at a time for a device: an earlier one still waiting gives way to this one.
            if let earlier = self.connectCalls.removeValue(forKey: id) { earlier.reject("A newer attempt took over.") }
            p.delegate = self
            if p.state == .connected { call.resolve(); return }
            self.connectCalls[id] = call
            self.servicesKnown.remove(id)
            c.connect(p, options: nil)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        servicesKnown.remove(peripheral.identifier)
        connectCalls.removeValue(forKey: peripheral.identifier)?.resolve()
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        connectCalls.removeValue(forKey: peripheral.identifier)?.reject(error?.localizedDescription ?? "The device did not connect.")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        dropped(peripheral, why: error?.localizedDescription ?? "The device disconnected.")
    }

    func disconnect(_ call: CAPPluginCall) {
        guard let p = peripheral(call) else { call.resolve(); return }
        connectCalls.removeValue(forKey: p.identifier)?.reject("Stopped.")
        if let c = central, c.state == .poweredOn, p.state != .disconnected {
            c.cancelPeripheralConnection(p)
        } else {
            dropped(p, why: "Stopped.")
        }
        call.resolve()
    }

    /// A link is gone: whatever was waiting on the device is answered, and the pages hear of it.
    private func dropped(_ p: CBPeripheral, why: String) {
        let id = p.identifier
        let prefix = id.uuidString + "|"
        connectCalls.removeValue(forKey: id)?.reject(why)
        servicesKnown.remove(id)
        serviceWaiters.removeValue(forKey: id)
        for k in characteristicCalls.keys.filter({ $0.hasPrefix(prefix) }) { characteristicCalls.removeValue(forKey: k)?.forEach { $0.reject(why) } }
        for k in readCalls.keys.filter({ $0.hasPrefix(prefix) }) { readCalls.removeValue(forKey: k)?.forEach { $0.reject(why) } }
        for k in writeCalls.keys.filter({ $0.hasPrefix(prefix) }) { writeCalls.removeValue(forKey: k)?.forEach { $0.reject(why) } }
        for k in notifyCalls.keys.filter({ $0.hasPrefix(prefix) }) { notifyCalls.removeValue(forKey: k)?.forEach { $0.reject(why) } }
        send?("btDisconnected", ["id": id.uuidString])
    }

    // MARK: services and characteristics

    /// Every service the device offers is asked for once per connection; later questions are answered from what came back.
    private func withServices(_ p: CBPeripheral, _ done: @escaping () -> Void) {
        let id = p.identifier
        if servicesKnown.contains(id) { done(); return }
        let first = serviceWaiters[id] == nil
        serviceWaiters[id, default: []].append(done)
        if first { p.discoverServices(nil) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        let id = peripheral.identifier
        servicesKnown.insert(id)
        let waiting = serviceWaiters.removeValue(forKey: id) ?? []
        waiting.forEach { $0() }
    }

    private func service(_ p: CBPeripheral, _ uuid: CBUUID) -> CBService? {
        return p.services?.first { AntogoBluetooth.full($0.uuid) == AntogoBluetooth.full(uuid) }
    }
    private func characteristic(_ p: CBPeripheral, _ call: CAPPluginCall) -> CBCharacteristic? {
        guard let s = call.getString("service"), let c = call.getString("characteristic"),
              let svc = service(p, CBUUID(string: s)) else { return nil }
        let want = AntogoBluetooth.full(CBUUID(string: c))
        return svc.characteristics?.first { AntogoBluetooth.full($0.uuid) == want }
    }

    func discover(_ call: CAPPluginCall) {
        guard let p = peripheral(call), p.state == .connected, let raw = call.getString("service") else { call.reject("The device is not connected."); return }
        let uuid = CBUUID(string: raw)
        withServices(p) {
            guard let svc = self.service(p, uuid) else { call.reject("This device has no such service."); return }
            if let chars = svc.characteristics {
                call.resolve(["characteristics": chars.map { AntogoBluetooth.full($0.uuid) }])
                return
            }
            let k = self.key(p, uuid)
            let first = self.characteristicCalls[k] == nil
            self.characteristicCalls[k, default: []].append(call)
            if first { p.discoverCharacteristics(nil, for: svc) }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        let waiting = characteristicCalls.removeValue(forKey: key(peripheral, service.uuid)) ?? []
        if let error = error {
            waiting.forEach { $0.reject(error.localizedDescription) }
            return
        }
        let names = (service.characteristics ?? []).map { AntogoBluetooth.full($0.uuid) }
        waiting.forEach { $0.resolve(["characteristics": names]) }
    }

    // MARK: reading, writing, listening

    func read(_ call: CAPPluginCall) {
        guard let p = peripheral(call), p.state == .connected, let c = characteristic(p, call), let svc = c.service else { call.reject("Not available on this device."); return }
        readCalls[key(p, svc.uuid, c.uuid), default: []].append(call)
        p.readValue(for: c)
    }

    func write(_ call: CAPPluginCall) {
        guard let p = peripheral(call), p.state == .connected, let c = characteristic(p, call), let svc = c.service,
              let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("Not available on this device."); return }
        let wantsReply = call.getBool("withResponse") ?? true
        let canReply = c.properties.contains(.write)
        let canSilent = c.properties.contains(.writeWithoutResponse)
        if (wantsReply && canReply) || !canSilent {
            writeCalls[key(p, svc.uuid, c.uuid), default: []].append(call)
            p.writeValue(data, for: c, type: .withResponse)
        } else {
            p.writeValue(data, for: c, type: .withoutResponse)
            call.resolve()
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let svc = characteristic.service else { return }
        let k = key(peripheral, svc.uuid, characteristic.uuid)
        guard var waiting = writeCalls[k], !waiting.isEmpty else { return }
        let call = waiting.removeFirst()
        writeCalls[k] = waiting.isEmpty ? nil : waiting
        if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
    }

    func notify(_ call: CAPPluginCall) {
        guard let p = peripheral(call), p.state == .connected, let c = characteristic(p, call), let svc = c.service else { call.reject("Not available on this device."); return }
        let on = call.getBool("on") ?? true
        if c.isNotifying == on { call.resolve(); return }
        notifyCalls[key(p, svc.uuid, c.uuid), default: []].append(call)
        p.setNotifyValue(on, for: c)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard let svc = characteristic.service else { return }
        let waiting = notifyCalls.removeValue(forKey: key(peripheral, svc.uuid, characteristic.uuid)) ?? []
        if let error = error { waiting.forEach { $0.reject(error.localizedDescription) } } else { waiting.forEach { $0.resolve() } }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let svc = characteristic.service else { return }
        let k = key(peripheral, svc.uuid, characteristic.uuid)
        let data = (characteristic.value ?? Data()).base64EncodedString()
        var answeredARead = false
        if var waiting = readCalls[k], !waiting.isEmpty {
            let call = waiting.removeFirst()
            readCalls[k] = waiting.isEmpty ? nil : waiting
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["data": data]) }
            answeredARead = true
        }
        if error != nil { return }
        // What a device sends unasked goes to the pages as it comes; the answer to a read is not sent twice.
        if characteristic.isNotifying || !answeredARead {
            send?("btValue", [
                "id": peripheral.identifier.uuidString,
                "service": AntogoBluetooth.full(svc.uuid),
                "characteristic": AntogoBluetooth.full(characteristic.uuid),
                "data": data,
            ])
        }
    }
}
