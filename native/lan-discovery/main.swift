import Foundation
import Darwin

final class Discovery: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    var browsers: [NetServiceBrowser] = []
    var services: [NetService] = []
    var targets: [[String: Any]] = []
    var failure: String?

    func start() {
        for type in ["_googlecast._tcp.", "_sonos._tcp."] {
            let browser = NetServiceBrowser()
            browser.delegate = self
            browsers.append(browser)
            browser.searchForServices(ofType: type, inDomain: "local.")
        }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard services.count < 64 else { return }
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 3)
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        failure = "Bonjour: \(errorDict[NetService.errorCode]?.intValue ?? 0)"
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        let txt = sender.txtRecordData().map { NetService.dictionary(fromTXTRecord: $0) } ?? [:]
        let sonos = sender.type == "_sonos._tcp."
        let uuid = sonos ? String(sender.name.split(separator: "@").first ?? "") : txt["id"].flatMap { String(data: $0, encoding: .utf8) } ?? ""
        guard !uuid.isEmpty else { return }
        let name = txt["fn"].flatMap { String(data: $0, encoding: .utf8) } ?? sender.name
        for data in sender.addresses ?? [] {
            let address: String? = data.withUnsafeBytes { bytes in
                guard bytes.count >= MemoryLayout<sockaddr_in>.size,
                      bytes.load(as: sockaddr.self).sa_family == sa_family_t(AF_INET) else { return nil }
                var ip = bytes.load(as: sockaddr_in.self).sin_addr
                var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                guard inet_ntop(AF_INET, &ip, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else { return nil }
                return String(cString: buffer)
            }
            let kind = sonos ? "sonos" : "chromecast"
            if let address = address, !targets.contains(where: { $0["id"] as? String == "\(kind):\(uuid)" }) {
                var target: [String: Any] = ["id": "\(kind):\(uuid)", "name": name, "protocol": kind, "address": address, "port": sender.port]
                if sonos, let location = txt["location"].flatMap({ String(data: $0, encoding: .utf8) }) {
                    target["location"] = location
                }
                targets.append(target)
            }
        }
    }

    func finish() {
        for browser in browsers { browser.stop() }
        for service in services { service.stop() }
        var result: [String: Any] = ["targets": targets]
        if let failure = failure { result["error"] = failure }
        if let data = try? JSONSerialization.data(withJSONObject: result), let text = String(data: data, encoding: .utf8) {
            print(text)
        }
    }
}
let discovery = Discovery()
discovery.start()
RunLoop.current.run(until: Date(timeIntervalSinceNow: 5))
discovery.finish()
