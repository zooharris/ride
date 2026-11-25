import UIKit
import Capacitor
import Security

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
